import test from 'node:test';
import assert from 'node:assert/strict';
import { MetasoClient } from '../mcp/metaso-client.mjs';
import { listTools } from '../mcp/tools.mjs';
import { validateToolArguments } from '../mcp/schema.mjs';
const json = value => new Response(JSON.stringify(value), {headers:{'content-type':'application/json'}});
const validate = (name,args) => validateToolArguments(listTools().find(t=>t.name===name),args);

test('official search schema reaches REST with string page and complete source metadata', async()=>{
 const args={q:'test',page:'10',includeSummary:true,conciseSnippet:true,includeRawContent:false};
 validate('metaso_search',args);
 const sample={credits:3,searchParameters:args,webpages:[{link:'https://example.com',summary:'s',position:1,authors:['A'],authorityDomain:'example.com'},{link:'https://example.org',snippet:'original'}]};
 const client=new MetasoClient({apiKey:'test',fetchImpl:async(url,options)=>{
  assert.equal(url,'https://metaso.cn/api/v1/search');
  assert.deepEqual(JSON.parse(options.body),{...args,scope:'webpage'});
  return json(sample);
 }});
 assert.deepEqual(await client.search(args),sample);
 validate('metaso_search',{q:'x',size:100});
 assert.throws(()=>validate('metaso_search',{q:'x',size:100,page:'1'}));
 assert.throws(()=>validate('metaso_search',{q:'x',page:'11'}));
});

test('legacy public tool names are rejected before dispatch',()=>{
 assert.throws(()=>validate('metaso_search',{query:'x'}));
 assert.throws(()=>validate('metaso_search',{q:'x',include_summary:true}));
 assert.throws(()=>validate('metaso_answer',{question:'x',concise_snippet:true}));
 assert.throws(()=>validate('metaso_search',{q:'x',size:5}));
});

test('answer defaults omit webpage and format, use messages, and preserve explicit simple/scholar',async()=>{
 const bodies=[];
 const c=new MetasoClient({apiKey:'test',fetchImpl:async(u,o)=>{bodies.push(JSON.parse(o.body));return json({choices:[{message:{content:'ok'}}]});}});
 validate('metaso_answer',{question:'x',conciseSnippet:false});
 await c.answer({question:'x',model:'fast',conciseSnippet:false});
 assert.deepEqual(bodies[0],{model:'fast',stream:false,conciseSnippet:false,messages:[{role:'user',content:'x'}]});
 await c.answer({question:'y',scope:'scholar',format:'simple'});
 assert.equal(bodies[1].scope,'scholar'); assert.equal(bodies[1].format,'simple');
});

test('SSE preserves citations across chunks and surfaces error events',async()=>{
 const a={link:'https://example.com'}, b={link:'https://example.org'};
 const events=[{choices:[{delta:{content:'A',citations:[a]}}]},{choices:[{delta:{content:'B',citations:[b,a]}}]},{credits:3}];
 const c=new MetasoClient({apiKey:'test',fetchImpl:async()=>new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})});
 const result=await c.answer({question:'x',stream:true});
 assert.equal(result.content,'AB'); assert.deepEqual(result.citations,[a,b]); assert.equal(result.usage.credits,3);
 c.fetch=async()=>new Response('data: {"error":{"code":400,"message":"bad request"}}\n\n',{headers:{'content-type':'text/event-stream'}});
 await assert.rejects(c.answer({question:'x',stream:true}),{code:400});
});

test('stream request tolerates JSON response instead of silently returning empty content',async()=>{
 const c=new MetasoClient({apiKey:'test',fetchImpl:async()=>json({choices:[{message:{content:'fallback'}}]})});
 const r=await c.answer({question:'x',stream:true}); assert.equal(r.choices[0].message.content,'fallback');
});
