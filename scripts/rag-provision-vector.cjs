// Creates a NEW container/volume; never replaces or stops the original database.
require("dotenv").config();
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
function docker(args, allowFailure=false) {
  const p=spawnSync("docker",args,{encoding:"utf8",windowsHide:true,env:{...process.env,POSTGRES_PASSWORD:process.env.DB_PASSWORD}});
  if(p.status && !allowFailure)throw new Error(`Docker operation failed: ${args[0]} ${args[1]} (no credentials logged)`);
  return p;
}
(async()=>{
  if(process.env.DB_NAME!=="raggen")throw new Error("Run only from RagGen with DB_NAME=raggen");
  if(docker(["inspect","raggen-db"],true).status===0)throw new Error("raggen-db already exists; refusing to overwrite it. Use the existing container.");
  fs.mkdirSync(".rag-data/backups",{recursive:true});
  docker(["exec","video-generator-db","pg_dump","-U",process.env.DB_USER,"-d","raggen","-Fc","-f","/tmp/raggen-phase1.dump"]);
  const dump=path.resolve(".rag-data/backups/phase1.dump");
  docker(["cp","video-generator-db:/tmp/raggen-phase1.dump",dump]);
  docker(["run","-d","--name","raggen-db","--restart","unless-stopped","-p","127.0.0.1:5441:5432","-e",`POSTGRES_USER=${process.env.DB_USER}`,"-e","POSTGRES_PASSWORD","-e","POSTGRES_DB=raggen","-v","raggen-pgvector-data:/var/lib/postgresql/data","pgvector/pgvector:pg16"]);
  let ready=false;for(let i=0;i<60;i++){if(!docker(["exec","raggen-db","pg_isready","-U",process.env.DB_USER,"-d","raggen"],true).status){ready=true;break;}await new Promise(r=>setTimeout(r,500));}
  if(!ready)throw new Error("New database did not become ready");
  docker(["cp",dump,"raggen-db:/tmp/phase1.dump"]);
  docker(["exec","raggen-db","pg_restore","-U",process.env.DB_USER,"-d","raggen","--no-owner","/tmp/phase1.dump"]);
  docker(["exec","raggen-db","psql","-U",process.env.DB_USER,"-d","raggen","-c","CREATE EXTENSION IF NOT EXISTS vector;"]);
  const original=fs.readFileSync(".env","utf8");fs.writeFileSync(".rag-data/backups/phase1.env",original);
  fs.writeFileSync(".env",original.replace(/^DB_PORT=.*$/m,'DB_PORT="5441"'));
  console.log("RagGen copied to pgvector container raggen-db on 5441. Original container untouched. Rollback configuration is in .rag-data/backups/phase1.env.");
})().catch(e=>{console.error(e.message);process.exitCode=1;});
