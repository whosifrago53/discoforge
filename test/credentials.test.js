const assert = require('assert');
const { parseCredentials: p } = require('../src/credentials');

let r = p('https://abliteration.ai/\ninternationaleventsm@gmail.com\n$]..password ');
assert.equal(r.status, 'ok');
console.log(r.text);
assert.ok(r.text.includes('> ### Credentials Abliteration') && r.text.includes('> **Password:** $]..password'));

r = p("kc_live_...key\nkey di kagedcap_gv3 con crediti illimitati per v3/ent e v2(ques'ultimo da aggiungere), usatela pure @whosifrago  @TIA\n\nhttps://kagedcap.io/docs#endpoint");
assert.equal(r.status, 'ok');
console.log(r.text);
assert.ok(r.text.includes('Credentials Kagedcap') && r.text.includes('**Api Key:** kc_live_...key'));

r = p('Replit\n123504-b6d4cb6f-5373-475e-b341-19b9c5407173  Access Token \n123504-aee24173-b6da-47b9-a393-99d899e40d4e     AutoSolve Bot API Keys \nAI-123504-9b3f26f7-064f-4152-bf9e-85063feea899    AI KEY');
console.log(r.text);
assert.equal(r.text, [
  '> ### Credentials Replit', '> ',
  '> **Api Key - Access Token:** 123504-b6d4cb6f-5373-475e-b341-19b9c5407173',
  '> **Api Key - AutoSolve Bot API Keys:** 123504-aee24173-b6da-47b9-a393-99d899e40d4e',
  '> **Api Key - AI KEY:** AI-123504-9b3f26f7-064f-4152-bf9e-85063feea899'].join('\n'));

r = p('restic\nQgA0PJo4DmXhS3BlaXBa7+RXSIv+ME7UGFxxMDxtDQU=\npassword server backup');
console.log(r.text);
assert.equal(r.text, '> ### Credentials Restic\n> \n> **Api Key:** QgA0PJo4DmXhS3BlaXBa7+RXSIv+ME7UGFxxMDxtDQU=');

r = p('netcup server per v3   se serve ssh ditemi\nIP address: 62.12.122.122/22, 2a03:4000:18:1359:78d3:beff:fef7:2d1f\nUsername: root\nRoot password: xI1passwordj');
console.log(r.text);
assert.equal(r.text, '> ### Credentials 62.12.122.122 server\n> **IP:** 62.12.122.122\n> **Username:** root\n> **Password:** xI1passwordj');

r = p('credenziali windows server per compilare\n159.159.16.200\nq~aaasefT=}8Flongpassword759j');
console.log(r.text);
assert.equal(r.text, '> ### Credentials 159.159.16.200 server\n> **IP:** 159.159.16.200\n> **Username:** Administrator\n> **Password:** q~aaasefT=}8Flongpassword759j');

assert.equal(p('server 10.0.0.1 password dimenticata?').status, 'incomplete');
assert.equal(p('il server 10.0.0.1 è giù').status, 'none');
assert.equal(p("Ecco l'api key bro: kc_live_...key").status, 'incomplete');
assert.equal(p('ciao ragazzi come va').status, 'none');
assert.equal(p('').status, 'none');
assert.equal(p('https://example.com').status, 'none');
assert.equal(p('**Website:** https://x.com\n**Email:** a@b.co\n**Password:** pw1').status, 'ok');
assert.equal(p('Api Key: abc123\nhttps://x.com').status, 'ok');
console.log('credentials ok');
