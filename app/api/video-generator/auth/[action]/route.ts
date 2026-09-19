import { boundedBody } from "@/lib/video-generator/rag/request";
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { authRequired,cookieToken,hashPassword,resolveIdentity,sameOrigin,tokenHash,verifyPassword } from "@/lib/rag-auth";
export const dynamic="force-dynamic";

function startSession(userId:string){
  const token=randomBytes(32).toString("base64url");
  return { token, create: prisma.ragSession.create({data:{id:tokenHash(token),userId,expiresAt:new Date(Date.now()+86400000)}}) };
}
function sessionCookieResponse(token:string){
  const res=NextResponse.json({ok:true});
  res.cookies.set("raggen-session",token,{httpOnly:true,sameSite:"strict",path:"/",secure:process.env.RAG_SECURE_COOKIES==="1",maxAge:86400});
  return res;
}

export async function POST(req:NextRequest,{params}:{params:{action:string}}){
  if(!sameOrigin(req))return NextResponse.json({message:"Origin not allowed"},{status:403});
  if(params.action==="logout"){
    await prisma.ragSession.deleteMany({where:{id:tokenHash(cookieToken(req))}});
    const res=NextResponse.json({ok:true});res.cookies.set("raggen-session","",{httpOnly:true,sameSite:"strict",path:"/",maxAge:0});return res;
  }
  if(params.action==="register"){
    if(!authRequired())return NextResponse.json({message:"Sign-in is not enabled"},{status:404});
    try{
      if(Number(req.headers.get("content-length"))>4096)return NextResponse.json({message:"Request too large"},{status:413});
      const {email,password,displayName}=z.object({
        email:z.string().email().max(254).transform(v=>v.toLowerCase()),
        password:z.string().min(8).max(256),
        displayName:z.string().trim().max(120).optional(),
        workspaceName:z.string().trim().max(120).optional(),
      }).parse(JSON.parse((await boundedBody(req,4096)).toString("utf8")));
      const existing=await prisma.ragUser.findUnique({where:{email}});
      if(existing)return NextResponse.json({message:"An account with this email already exists"},{status:409});
      const passwordHash=await hashPassword(password);
      const workspaceId=process.env.VIDEO_GENERATOR_TENANT_ID||"raggen";
      const user=await prisma.$transaction(async tx=>{
        await tx.ragWorkspace.upsert({where:{id:workspaceId},create:{id:workspaceId,name:"RagGen",databaseName:workspaceId},update:{}});
        const created=await tx.ragUser.create({data:{email,name:displayName||email.split("@")[0],passwordHash}});
        await tx.ragMembership.create({data:{userId:created.id,workspaceId,role:"OWNER"}});
        return created;
      });
      const { token, create } = startSession(user.id);
      await create;
      return sessionCookieResponse(token);
    }catch(err){
      if(err instanceof z.ZodError)return NextResponse.json({message:"Enter a valid email and a password with at least 8 characters."},{status:400});
      return NextResponse.json({message:"Could not create account"},{status:400});
    }
  }
  if(params.action!=="login"||!authRequired())return NextResponse.json({message:"Sign-in is not enabled"},{status:404});
  try{
    if(Number(req.headers.get("content-length"))>4096)return NextResponse.json({message:"Request too large"},{status:413});
    const {email,password}=z.object({email:z.string().email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(1).max(256)}).parse(JSON.parse((await boundedBody(req,4096)).toString("utf8")));
    const key=`login:${tokenHash(email)}`;const expiresAt=new Date(Date.now()+15*60000);
    const allowed=await prisma.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const row=await tx.ragCache.findFirst({where:{id:key,expiresAt:{gt:new Date()}}});const count=Number((row?.value as any)?.count||0);
      if(count>=10)return false;
      await tx.ragCache.upsert({where:{id:key},create:{id:key,scope:"auth-throttle",value:{count:count+1},expiresAt},update:{value:{count:count+1},expiresAt:row?.expiresAt||expiresAt}});return true;
    });
    if(!allowed)return NextResponse.json({message:"Too many sign-in attempts. Try again in 15 minutes."},{status:429});
    const user=await prisma.ragUser.findUnique({where:{email}});
    const valid=await verifyPassword(password,user?.passwordHash||`${"0".repeat(32)}:${"0".repeat(128)}`);
    if(!user||user.disabled||!valid)return NextResponse.json({message:"Invalid email or password"},{status:401});
    const token=randomBytes(32).toString("base64url");await prisma.ragSession.create({data:{id:tokenHash(token),userId:user.id,expiresAt:new Date(Date.now()+86400000)}});
    await prisma.ragCache.deleteMany({where:{id:key}});
    const res=NextResponse.json({ok:true});res.cookies.set("raggen-session",token,{httpOnly:true,sameSite:"strict",path:"/",secure:process.env.RAG_SECURE_COOKIES==="1",maxAge:86400});return res;
  }catch{return NextResponse.json({message:"Invalid sign-in request"},{status:400});}
}
