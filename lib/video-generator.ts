// Single source of truth for the Video Generator feature rollout flag.
//
// Reads the NEXT_PUBLIC_ flag (inlined at build time, so this works in both server and
// client components). The feature is a kill-switch: ON by default, shipped dark by setting
// NEXT_PUBLIC_VIDEO_GENERATOR_ENABLED="false". Access is *also* gated by the MANAGE_VIDEO_GENERATOR
// permission (sidebar nav, the /video-generator route, and every /api/video-generator/* handler) —
// this flag is the global on/off on top of that.

export function isVideoGeneratorEnabled(): boolean {
  return process.env.NEXT_PUBLIC_VIDEO_GENERATOR_ENABLED !== "false";
}
