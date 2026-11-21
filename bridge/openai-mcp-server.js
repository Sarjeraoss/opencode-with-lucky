'use strict';

// Clipbot OpenAI brain + read-only MCP gateway.
// The ESP32 continues to POST /chat; MCP is a separate interface for clients.
const http = require('node:http');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 10000);
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
const MCP_TOKEN = process.env.MCP_TOKEN || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const SYSTEM = 'You are Lucy, a friendly cat companion on a tiny monochrome OLED. Answer accurately, in simple plain text with no markdown. Usually use one or two short sentences (at most 45 words). If uncertain say so. Respond in the language the user uses, using Latin transliteration when necessary because the OLED has limited font support. You cannot physically hear or see the world unless information is supplied to you.';
const started = Date.now();
const maxBody = 16384;
const buckets = new Map();
let lastProviderStatus = null;
let lastProviderError = null;

if (BRIDGE_TOKEN.length < 24 || BRIDGE_TOKEN.startsWith('CHANGE_ME') ||
    MCP_TOKEN.length < 24 || MCP_TOKEN.startsWith('CHANGE_ME') ||
    BRIDGE_TOKEN === MCP_TOKEN) {
  console.error('Set two different random secrets BRIDGE_TOKEN and MCP_TOKEN, each >=24 chars.');
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error('Invalid PORT'); process.exit(1);
}
function secureEqual(a,b) {
  const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||''));
  return x.length === y.length && crypto.timingSafeEqual(x,y);
}
function send(res,status,payload) {
  const data=JSON.stringify(payload);
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':Buffer.byteLength(data)});
  res.end(data);
}
function bodyJson(req) {
  return new Promise((resolve,reject)=>{
    const pieces=[];let bytes=0, failed=false;
    req.on('data',chunk=>{
      bytes+=chunk.length;
      if(bytes>maxBody) { failed=true; reject(Object.assign(new Error('Body too large'),{code:413})); req.destroy(); }
      else pieces.push(chunk);
    });
    req.on('end',()=>{
      if(failed)return;
      try{ resolve(JSON.parse(Buffer.concat(pieces).toString('utf8'))); }
      catch{reject(Object.assign(new Error('Invalid JSON'),{code:400}));}
    });
    req.on('error',reject);
  });
}
function rateLimit(req) {
  const ip=req.socket.remoteAddress||'unknown',now=Date.now();
  let b=buckets.get(ip);
  if(!b||now>=b.until){ b={count:0,until:now+60000};buckets.set(ip,b); }
  b.count++;
  if(buckets.size>500) for(const [k,v] of buckets) if(v.until<now)buckets.delete(k);
  return b.count<=20;
}
function validateMessages(messages) {
  if(!Array.isArray(messages)||!messages.length)throw Object.assign(new Error('messages must be non-empty'),{code:400});
  const result=[];
  for(const m of messages.slice(-8)){
    if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string')continue;
    const content=m.content.trim();
    if(content.length>1200) throw Object.assign(new Error('message too long'),{code:400});
    if(content)result.push({role:m.role,content});
  }
  if(!result.length||result[result.length-1].role!=='user')throw Object.assign(new Error('last message must be user'),{code:400});
  return result;
}
function extractText(json){
  if(typeof json.output_text==='string'&&json.output_text.trim())return json.output_text.trim();
  const segments=[];
  for(const item of json.output||[])
    for(const part of item.content||[])
      if(part.type==='output_text'&&typeof part.text==='string')segments.push(part.text);
  return segments.join('\n').trim();
}
async function answer(messages) {
  if(!OPENAI_API_KEY)return {error:'OpenAI provider not configured. Set OPENAI_API_KEY in Render.',status:503};
  const ac=new AbortController();
  const timeout=setTimeout(()=>ac.abort(),30000);
  try {
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',signal:ac.signal,
      headers:{'Authorization':'Bearer '+OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({model:OPENAI_MODEL,instructions:SYSTEM,
        input:messages,max_output_tokens:160,store:false})
    });
    lastProviderStatus=response.status;
    if(!response.ok){
      // Never leak upstream response body, keys, or user text.
      const codes={400:'Invalid model or request',401:'OpenAI API key rejected',403:'OpenAI project lacks access',404:'Model not found',429:'OpenAI rate limit or quota',500:'OpenAI service error',502:'OpenAI service error',503:'OpenAI service unavailable'};
      lastProviderError=codes[response.status]||'OpenAI request failed';
      return {error:lastProviderError,status:response.status===429?429:502};
    }
    const data=await response.json();
    const reply=extractText(data);
    if(!reply){lastProviderError='OpenAI produced no text';return {error:lastProviderError,status:502};}
    lastProviderError=null;
    return {reply:reply.slice(0,600),model:OPENAI_MODEL};
  } catch(err){
    lastProviderError=err.name==='AbortError'?'OpenAI request timed out':'OpenAI connection failed';
    return {error:lastProviderError,status:502};
  } finally {clearTimeout(timeout);}
}
function rpc(id,result){return {jsonrpc:'2.0',id,result};}
function rpcError(id,code,message){return {jsonrpc:'2.0',id,error:{code,message}};}
async function mcp(request){
  if(!request||request.jsonrpc!=='2.0'||typeof request.method!=='string')
    return rpcError(request&&request.id!==undefined?request.id:null,-32600,'Invalid Request');
  const id=request.id;
  if(id===undefined)return null; // notifications do not receive JSON-RPC responses
  if(request.method==='initialize')return rpc(id,{
    protocolVersion:'2025-06-18',
    capabilities:{tools:{listChanged:false}},
    serverInfo:{name:'clipbot-openai-gateway',version:'1.0.0'}
  });
  if(request.method==='ping')return rpc(id,{});
  if(request.method==='tools/list')return rpc(id,{tools:[
    {name:'ask_openai',description:'Ask the configured OpenAI model a short question. Requires the provider key on the server.',inputSchema:{type:'object',properties:{question:{type:'string',maxLength:1200}},required:['question'],additionalProperties:false}},
    {name:'bridge_status',description:'Read non-secret service status.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true}}
  ]});
  if(request.method==='tools/call'){
    const name=request.params&&request.params.name,args=request.params&&request.params.arguments||{};
    if(name==='bridge_status')return rpc(id,{content:[{type:'text',text:JSON.stringify({ok:true,providerConfigured:!!OPENAI_API_KEY,model:OPENAI_MODEL,uptimeSeconds:Math.floor((Date.now()-started)/1000)})}],isError:false});
    if(name==='ask_openai'){
      if(typeof args.question!=='string'||!args.question.trim()||args.question.length>1200)
        return rpcError(id,-32602,'Invalid question');
      const result=await answer([{role:'user',content:args.question}]);
      return rpc(id,{content:[{type:'text',text:result.reply||result.error}],isError:!!result.error});
    }
    return rpcError(id,-32602,'Unknown tool');
  }
  return rpcError(id,-32601,'Method not found');
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/health'){
    send(res,200,{ok:true,service:'clipbot-openai-mcp',providerConfigured:!!OPENAI_API_KEY,model:OPENAI_MODEL,uptimeSeconds:Math.floor((Date.now()-started)/1000)});
    return;
  }
  if(req.method==='GET'&&url.pathname==='/diagnostics'){
    if(!secureEqual(req.headers['x-bridge-token'],BRIDGE_TOKEN)){send(res,401,{error:'Unauthorized'});return;}
    send(res,200,{providerConfigured:!!OPENAI_API_KEY,model:OPENAI_MODEL,lastProviderStatus,lastProviderError});
    return;
  }
  if(req.method==='POST'&&url.pathname==='/chat'){
    if(!secureEqual(req.headers['x-bridge-token'],BRIDGE_TOKEN)){send(res,401,{error:'Unauthorized'});return;}
    if(!rateLimit(req)){send(res,429,{error:'Too many requests'});return;}
    try {
      const obj=await bodyJson(req);
      const messages=validateMessages(obj.messages);
      const result=await answer(messages);
      send(res,result.status||200,result.error?{error:result.error}:{reply:result.reply,model:result.model});
    } catch(e){if(!res.headersSent&&!res.destroyed)send(res,e.code||400,{error:e.message||'Invalid request'});}
    return;
  }
  if(req.method==='POST'&&url.pathname==='/mcp'){
    if(!secureEqual((req.headers.authorization||'').replace(/^Bearer /i,''),MCP_TOKEN)){send(res,401,{error:'Unauthorized'});return;}
    if(!rateLimit(req)){send(res,429,{error:'Too many requests'});return;}
    try{
      const msg=await bodyJson(req);
      const response=await mcp(msg);
      if(response===null){res.writeHead(202);res.end();}else send(res,200,response);
    }catch(e){if(!res.headersSent&&!res.destroyed)send(res,e.code||400,{error:e.message||'Invalid request'});}
    return;
  }
  send(res,404,{error:'Not found'});
});
server.listen(PORT,'0.0.0.0',()=>console.log('Clipbot OpenAI + MCP listening on port',PORT));
