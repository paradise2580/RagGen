// GET /api/video-generator/generations/prompt-template?serviceType=&modelType=
//
// Static preview of the prompt profile for the generate screen. The pipeline uses a
// fixed prompt structure (see lib/video-generator/pipeline.ts buildPromptMessages), so
// this returns a deterministic description of it.

import { NextResponse, type NextRequest } from "next/server";
import { gateVideoGenerator, jsonError } from "@/lib/video-generator/context";
import { resolveWorkflowName } from "@/lib/video-generator/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

const PROFILE: Record<string, { profileKey: string; label: string; subjectMode: string; describeMode: string }> = {
  NO_MODEL: { profileKey: "product_video_no_model", label: "Product video (no model)", subjectMode: "none", describeMode: "product" },
  EXISTING_MODEL_PHOTO: { profileKey: "product_on_model_video", label: "On-model video", subjectMode: "existing_model", describeMode: "both" },
  PERSONALIZED_MODEL: { profileKey: "product_personalized_model_video", label: "Personalized model video", subjectMode: "personalized_model", describeMode: "both" },
  AI_MODEL: { profileKey: "product_ai_model_video", label: "AI model video", subjectMode: "ai_model", describeMode: "both" },
};

export async function GET(req: NextRequest) {
  const gate = await gateVideoGenerator(req);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const serviceType = url.searchParams.get("serviceType") || "";
  const modelType = url.searchParams.get("modelType") || "";
  if (!resolveWorkflowName(serviceType, modelType)) {
    return jsonError(`Unsupported combination: ${serviceType} + ${modelType}`, 400);
  }
  const p = PROFILE[modelType] ?? PROFILE.NO_MODEL;

  return NextResponse.json(
    {
      profileKey: p.profileKey,
      label: p.label,
      format: "video",
      subjectMode: p.subjectMode,
      describeMode: p.describeMode,
      defaultSceneCount: 1,
      minSceneCount: 1,
      maxSceneCount: 6,
      systemInstructions:
        "Generate a single vivid image-to-video ad prompt: camera motion, lighting, mood, hero framing for a short premium e-commerce product video.",
      describeSystem:
        "Analyze the reference image(s); describe the product" +
        (p.describeMode === "both" ? " and any model/person." : "."),
      klingContract: "Output JSON { finalPrompt, negativePrompt } consumed by Kling image2video.",
      configVersion: null,
      configSource: "default",
    },
    { headers: noStore },
  );
}
