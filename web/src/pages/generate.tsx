import React from "react";
import { BrandPicker } from "../components/RagContext";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, uploadAssets, type Asset, type GenerationJob } from "../lib/api";
import { useAssets, useProducts, useWorkspaceKey } from "../lib/queries";
import {
  AI_MODEL_AGES,
  AI_MODEL_GENDERS,
  AI_MODEL_SKIN_TONES,
  ASPECT_RATIOS,
  COMING_SOON_MODEL_TYPES,
  DEFAULT_AI_MODEL,
  DEFAULT_RESOLUTION,
  MODEL_TYPES_REQUIRING_AI_MODEL,
  MODEL_TYPES_REQUIRING_ASSET,
  MODEL_TYPES_REQUIRING_POSES,
  MAX_USER_INSTRUCTIONS,
  RESOLUTIONS,
  SERVICE_TYPES,
  USER_INSTRUCTIONS_PLACEHOLDER,
  defaultModelTypeForService,
  isModelTypeValidForService,
  modelLabel,
  modelTypesForService,
  resolutionLabel,
} from "../lib/generation-options";
import type { IconName } from "../components/Icon";
import {
  Button,
  DropdownMenu,
  EmptyState,
  FormField,
  Icon,
  InlineMessage,
  Input,
  MediaCard,
  Modal,
  SelectMenu,
  Textarea,
  useToast,
} from "../components";
import { AssetPicker } from "./_asset-picker";
import { FileDropzone } from "./_dropzone";
import "./composer.css";

/** Max model poses per Personalized Model brief — mirrors the API's
 * modelPoses cap so the uploader can't collect more than the server accepts. */
const MAX_MODEL_POSES = 8;

/** Selectable angle labels for each product photo / model pose (Personalized Model).
 * These are the only choices offered in the angle dropdown — add more here as needed.
 * The chosen angle is stored as metadata alongside each pose for the pipeline to use. */
const ANGLE_SUGGESTIONS = [
  "front",
  "back",
  "left side",
  "right side",
  "front close",
  "back close",
  "three-quarter",
] as const;

/** A model pose: the uploaded image asset plus the user-entered angle label. */
interface ModelPose {
  asset: Asset;
  angle: string;
}

/** AI Model settings — the fixed knobs the pipeline generates a model from. */
interface AiModelSettings {
  gender: string;
  age: string;
  skinTone: string;
}

interface GenerateDraft {
  brandId: string;
  serviceType: string;
  modelType: string;
  productId: string;
  modelAssetId: string;
  aspectRatio: string;
  resolution: string;
  durationSeconds: number;
  userInstructions: string;
}

const DRAFT_KEY = "adstudio-generate-draft";

const DEFAULT_DURATION_SECONDS = 5;
// Kling image-to-video renders only 5s or 10s clips — offer exactly those so the
// chosen duration always matches what's produced.
const DURATION_OPTIONS = [5, 10] as const;
const DURATION_HINT: Record<number, string> = {
  5: "Short",
  10: "Standard",
};

const DEFAULT_DRAFT: GenerateDraft = {
  brandId: "",
  serviceType: "PRODUCT_VIDEO_AD",
  modelType: "NO_MODEL",
  productId: "",
  modelAssetId: "",
  // U2: default to "auto" so the video matches the source image's aspect unless
  // the user deliberately forces a canvas.
  aspectRatio: "auto",
  resolution: DEFAULT_RESOLUTION,
  durationSeconds: DEFAULT_DURATION_SECONDS,
  userInstructions: "",
};

function readDraft(ws: string): Partial<GenerateDraft> {
  try {
    const raw = window.sessionStorage.getItem(`${DRAFT_KEY}:${ws}`);
    return raw ? (JSON.parse(raw) as Partial<GenerateDraft>) : {};
  } catch {
    return {};
  }
}

function writeDraft(ws: string, draft: GenerateDraft): void {
  try {
    window.sessionStorage.setItem(`${DRAFT_KEY}:${ws}`, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

function clearDraft(ws: string): void {
  try {
    window.sessionStorage.removeItem(`${DRAFT_KEY}:${ws}`);
  } catch {
    /* ignore */
  }
}

// "auto" is a behavior, not a ratio — show a friendly label instead of "auto".
const aspectValueLabel = (r: string) => (r === "auto" ? "Auto" : r);

export function GeneratePage() {
  const navigate = useNavigate();
  const ws = useWorkspaceKey();
  const [searchParams] = useSearchParams();
  // Studios deep-link here with ?product=<id> and/or ?service=<GenerationServiceType>.
  const presetProduct = searchParams.get("product") ?? "";
  const presetServiceRaw = searchParams.get("service") ?? "";
  const presetService = SERVICE_TYPES.some((s) => s.value === presetServiceRaw)
    ? presetServiceRaw
    : "";

  // Rehydrate any in-progress draft so leaving and returning keeps the user's place.
  const initial = React.useMemo(() => ({ ...DEFAULT_DRAFT, ...readDraft(ws) }), [ws]);

  const [serviceType, setServiceType] = React.useState(presetService || initial.serviceType);
  const [modelType, setModelType] = React.useState(initial.modelType);
  const [productId, setProductId] = React.useState(presetProduct || initial.productId);
  const [modelAssetId, setModelAssetId] = React.useState(initial.modelAssetId);
  const [aspectRatio, setAspectRatio] = React.useState(initial.aspectRatio);
  const [resolution, setResolution] = React.useState(
    RESOLUTIONS.includes(initial.resolution as (typeof RESOLUTIONS)[number])
      ? initial.resolution
      : DEFAULT_RESOLUTION,
  );
  const [durationSeconds, setDurationSeconds] = React.useState(
    DURATION_OPTIONS.includes(initial.durationSeconds as (typeof DURATION_OPTIONS)[number])
      ? initial.durationSeconds
      : DEFAULT_DURATION_SECONDS,
  );
  // The user's brief for the video — the primary creative direction, sent verbatim to
  // the pipeline. Restored from the draft so a half-written brief survives a reload.
  const [userInstructions, setUserInstructions] = React.useState(
    (initial.userInstructions ?? "").slice(0, MAX_USER_INSTRUCTIONS),
  );
  const [campaign, setCampaign] = React.useState("");
  const referenceCaptionId = searchParams.get("referenceCaptionId") || "";
  const [brandId, setBrandId] = React.useState(initial.brandId || "");
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [productModalOpen, setProductModalOpen] = React.useState(false);
  const [poseModalOpen, setPoseModalOpen] = React.useState(false);
  const [aiModelModalOpen, setAiModelModalOpen] = React.useState(false);
  // AI Model: the generated-model settings (gender/age/skin tone + optional free-text).
  // Not persisted in the draft — it's cheap to re-pick and keeps the draft schema stable.
  const [aiModel, setAiModel] = React.useState<AiModelSettings>({ ...DEFAULT_AI_MODEL });
  // Personalized Model: uploaded model-pose photos (each try-on'd with the product).
  // Held as full assets so thumbnails render; only their ids are submitted. Not
  // persisted in the draft (assets live server-side; re-uploading is cheap and clear).
  const [modelPoses, setModelPoses] = React.useState<ModelPose[]>([]);
  // Which of the product's images the video is generated from. Defaults to all;
  // the user can narrow the selection in the Product picker.
  const [selectedImageIds, setSelectedImageIds] = React.useState<string[]>([]);
  // Personalized Model: user-entered angle label per product photo (keyed by image id).
  // Used by the try-on pairing step to match a garment side to a model pose.
  const [productAngles, setProductAngles] = React.useState<Record<string, string>>({});

  // Persist the draft on every change.
  React.useEffect(() => {
    writeDraft(ws, {
      brandId,
      serviceType,
      modelType,
      productId,
      modelAssetId,
      aspectRatio,
      resolution,
      durationSeconds,
      userInstructions,
    });
  }, [
    brandId,
    ws,
    serviceType,
    modelType,
    productId,
    modelAssetId,
    aspectRatio,
    resolution,
    durationSeconds,
    userInstructions,
  ]);

  // A rehydrated or stale draft could hold a (service, model) pair that is no longer
  // valid; snap it back to a supported model so the API never rejects the brief.
  React.useEffect(() => {
    if (!isModelTypeValidForService(serviceType, modelType)) {
      setModelType(defaultModelTypeForService(serviceType));
      setModelAssetId("");
    }
  }, [serviceType, modelType]);

  function handleModelChange(value: string) {
    setModelType(value);
    setModelAssetId("");
    setModelPoses([]);
    setAiModel({ ...DEFAULT_AI_MODEL });
  }

  function resetAll() {
    setBrandId("");
    setServiceType(DEFAULT_DRAFT.serviceType);
    setModelType(DEFAULT_DRAFT.modelType);
    setProductId(DEFAULT_DRAFT.productId);
    setModelAssetId(DEFAULT_DRAFT.modelAssetId);
    setModelPoses([]);
    setAiModel({ ...DEFAULT_AI_MODEL });
    setProductAngles({});
    setAspectRatio(DEFAULT_DRAFT.aspectRatio);
    setResolution(DEFAULT_DRAFT.resolution);
    setDurationSeconds(DEFAULT_DRAFT.durationSeconds);
    setUserInstructions(DEFAULT_DRAFT.userInstructions);
    clearDraft(ws);
  }

  const { data: products } = useProducts();
  const { data: assets } = useAssets();

  const needsModelAsset = MODEL_TYPES_REQUIRING_ASSET.has(modelType);
  const needsPoses = MODEL_TYPES_REQUIRING_POSES.has(modelType);
  const needsAiModel = MODEL_TYPES_REQUIRING_AI_MODEL.has(modelType);
  // Flows that fit the garment onto a model (uploaded pose OR generated AI model) need a
  // per-product-photo angle label so the try-on pairing applies the right garment side.
  const needsProductAngles = needsPoses || needsAiModel;
  // Duration only applies to video service types; the model picks start/end frames.
  const isVideo = serviceType === "PRODUCT_VIDEO_AD";

  const selectedProduct = (products ?? []).find((p) => p.id === productId);
  // A product's images ARE its source-image URLs (imageAssetIds, from ProductRecord) —
  // not rows in the generated-asset library. The URL doubles as the selectable id and the
  // src, and the backend accepts these URLs as productImageAssetIds (validated against the
  // product's own images). See lib/video-generator/{mappers,pipeline}.ts.
  const productImages = (selectedProduct?.imageAssetIds ?? []).map((url) => ({
    id: url,
    cdnUrl: url,
  }));
  const selectedImages = productImages.filter((a) => selectedImageIds.includes(a.id));
  const productThumb = (selectedImages[0] ?? productImages[0])?.cdnUrl;

  // Default to using every product image; re-initialize when the product (or its
  // image set) changes so a freshly picked product starts with all frames selected.
  // Keyed on id + count (not the array) so the user's in-modal toggles aren't reset
  // on every render.
  React.useEffect(() => {
    setSelectedImageIds(productImages.map((a) => a.id));
    setProductAngles({}); // angles are per-image; a new product invalidates them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, productImages.length]);

  function setProductAngle(id: string, angle: string) {
    setProductAngles((prev) => ({ ...prev, [id]: angle }));
  }

  function toggleProductImage(id: string) {
    setSelectedImageIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const createMutation = useMutation({
    mutationFn: () => {
      // "Product On Model" (EXISTING_MODEL_PHOTO) animates an on-model product photo
      // directly — the model lives in the selected photos, so no separate model image
      // is required. It submits as-is so the pipeline runs the on-model video flow
      // (and the model-presence check requires a model in the chosen photos).
      return api.post<GenerationJob>("/api/generations", {
        serviceType,
        modelType,
        productId,
        aspectRatio,
        resolution: isVideo ? resolution : undefined,
        modelAssetId: needsModelAsset && modelAssetId ? modelAssetId : undefined,
        // AI Model: the generated-model settings. The pipeline synthesizes a clothed
        // model from these, then virtual-try-ons the product onto it.
        aiModel: needsAiModel
          ? {
              gender: aiModel.gender,
              age: aiModel.age,
              skinTone: aiModel.skinTone,
            }
          : undefined,
        // Personalized Model sends the uploaded poses with their angle labels (never a
        // single modelAssetId). The backend try-on stage wraps the product onto each;
        // the angle is stored as metadata for later pipeline use.
        modelPoses:
          needsPoses && modelPoses.length > 0
            ? modelPoses.map((p) => ({ assetId: p.asset.id, angle: p.angle.trim() }))
            : undefined,
        productImageAssetIds: selectedImageIds.length > 0 ? selectedImageIds : undefined,
        // Personalized Model: the selected product photos with their angle labels, so
        // the pairing step can match a garment side to a model pose.
        productImages:
          needsProductAngles && selectedImageIds.length > 0
            ? selectedImageIds.map((id) => ({ assetId: id, angle: (productAngles[id] ?? "").trim() }))
            : undefined,
        shotDurationSeconds: isVideo ? durationSeconds : undefined,
        // The brief. Primary direction for the whole pipeline — see the composer box.
        userInstructions: userInstructions.trim(),
        brandId: brandId || undefined,
        campaign: campaign || undefined,
        referenceCaptionId: referenceCaptionId || undefined,
      });
    },
    onSuccess: (job) => {
      clearDraft(ws);
      void navigate(`/generations/${job.id}`);
    },
  });

  const selectedModelAsset = (assets ?? []).find((a) => a.id === modelAssetId);

  const { notify } = useToast();
  // Personalized Model: poses can be uploaded in batches; each is appended with a blank
  // angle the user then labels. Capped at MAX_MODEL_POSES.
  const poseUploadMutation = useMutation({
    mutationFn: (files: File[]) => uploadAssets(files),
    onSuccess: (result) => {
      if (result.assets.length > 0) {
        setModelPoses((prev) =>
          [...prev, ...result.assets.map((asset) => ({ asset, angle: "" }))].slice(
            0,
            MAX_MODEL_POSES,
          ),
        );
      }
      if (result.failures.length > 0) {
        notify({
          tone: "error",
          title: `Uploaded ${result.assets.length}, ${result.failures.length} failed`,
          description: result.failures[0]?.message,
        });
      }
    },
    onError: (error: Error) =>
      notify({ tone: "error", title: "Upload failed", description: error.message }),
  });

  function setPoseAngle(assetId: string, angle: string) {
    setModelPoses((prev) => prev.map((p) => (p.asset.id === assetId ? { ...p, angle } : p)));
  }
  function removePose(assetId: string) {
    setModelPoses((prev) => prev.filter((p) => p.asset.id !== assetId));
  }

  const poseSlotsLeft = MAX_MODEL_POSES - modelPoses.length;
  // Every uploaded pose must carry a non-empty angle label (the metadata is the point).
  const posesLabeled = modelPoses.every((p) => p.angle.trim().length > 0);

  // Readiness — drives the Generate button and the "what's missing" hint.
  // The user picks a product and which of its images the video is built from.
  // Personalized Model additionally needs an angle label on every selected photo.
  const productAnglesLabeled =
    !needsProductAngles || selectedImageIds.every((id) => (productAngles[id] ?? "").trim().length > 0);
  const productReady =
    Boolean(productId) && selectedImageIds.length > 0 && productAnglesLabeled;
  const aiModelReady =
    !needsAiModel ||
    (Boolean(aiModel.gender) && Boolean(aiModel.age) && Boolean(aiModel.skinTone));
  const modelReady =
    (!needsModelAsset || Boolean(modelAssetId)) &&
    (!needsPoses || (modelPoses.length > 0 && posesLabeled)) &&
    aiModelReady;
  // AI model has no pipeline yet — block generation for it.
  const comingSoon = COMING_SOON_MODEL_TYPES.has(modelType);
  // The brief is required here even though the API tolerates its absence: with no
  // templates left, an empty box means nothing at all is directing the shot.
  const briefReady = userInstructions.trim().length > 0;
  const canSubmit =
    productReady && modelReady && briefReady && Boolean(aspectRatio) && !comingSoon;

  const missing: string[] = [];
  if (!briefReady) missing.push("a description of the video you want");
  if (!productId) missing.push("a product");
  else if (productImages.length === 0) missing.push("at least one product image");
  else if (selectedImageIds.length === 0) missing.push("at least one selected image");
  else if (needsProductAngles && !productAnglesLabeled) missing.push("an angle label for each selected photo");
  if (needsModelAsset && !modelAssetId) missing.push("a model image");
  if (needsPoses && modelPoses.length === 0) missing.push("at least one model pose");
  else if (needsPoses && !posesLabeled) missing.push("an angle label for each pose");

  const hasProducts = (products ?? []).length > 0;
  const modelOptions = modelTypesForService(serviceType);

  return (
    <div className="route-view composer-view">
      {!hasProducts ? (
        <EmptyState
          icon="products"
          title="Add a product first"
          description="Generations are built from a product and its images. Add a product on the Products page to begin."
        />
      ) : (
        <>
          <h1 className="composer-title">Weee :)</h1>
          <BrandPicker value={brandId} onChange={setBrandId} brief={userInstructions} productId={productId} serviceType={serviceType} modelType={modelType} campaign={campaign} />
          {brandId && <FormField label="Campaign (optional)" hint="Use the exact campaign name saved on your brand documents."><Input value={campaign} maxLength={120} onChange={e => setCampaign(e.target.value)} /></FormField>}
          {referenceCaptionId && <p role="status">An approved library caption will guide this creative brief.</p>}
          <div className="composer">
            <div className="composer__glow" aria-hidden="true" />

            {/* Center body: prompt + chips */}
            <div className="composer__body">
              <div className="composer__promptrow">
                {comingSoon ? (
                  <div
                    className="composer__comingsoon"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="composer__comingsoon-title">Coming soon</span>
                    <span className="composer__comingsoon-sub">
                      {modelLabel(modelType)} generations aren’t available yet. Pick “No model”
                      or “Existing model photo” to generate.
                    </span>
                  </div>
                ) : null}
                {/* The brief. Whatever is typed here is the primary direction for the
                    generation: it reaches the describe, keyframe-selection and prompt
                    stages verbatim, and the prompt model is told to follow it over its
                    own instincts. Only product/model fidelity and the keyframe limits
                    (the engine can't show a side no photo contains) outrank it. */}
                <Textarea
                  className="composer__prompt"
                  value={userInstructions}
                  onChange={(e) => setUserInstructions(e.target.value)}
                  placeholder={USER_INSTRUCTIONS_PLACEHOLDER}
                  maxLength={MAX_USER_INSTRUCTIONS}
                  rows={2}
                  aria-label="Describe the video you want"
                />

                <div className="composer__tiles">
                  {modelType === "EXISTING_MODEL_PHOTO" ? (
                    // With no model selected, "Product On Model" behaves exactly like
                    // the Product tile: pick a catalogue product. The label is kept;
                    // the brief runs as a product (no-model) generation.
                    <AddTile
                      label="Product On Model"
                      icon="products"
                      set={productReady}
                      thumb={productThumb}
                      onClick={() => setProductModalOpen(true)}
                    />
                  ) : (
                    <>
                      <AddTile
                        label="Product"
                        icon="products"
                        set={productReady}
                        thumb={productThumb}
                        onClick={() => setProductModalOpen(true)}
                      />
                      {needsModelAsset ? (
                        <AddTile
                          label="Model"
                          icon="workspace"
                          set={Boolean(modelAssetId)}
                          thumb={selectedModelAsset?.cdnUrl}
                          hint="Choose a model image"
                          required={!modelAssetId}
                          onClick={() => setPickerOpen(true)}
                        />
                      ) : null}
                      {needsPoses ? (
                        <AddTile
                          label={
                            modelPoses.length > 0
                              ? `Model poses (${modelPoses.length})`
                              : "Model poses"
                          }
                          icon="workspace"
                          set={modelPoses.length > 0 && posesLabeled}
                          thumb={modelPoses[0]?.asset.cdnUrl}
                          hint="Upload & label model pose photos"
                          required={modelPoses.length === 0 || !posesLabeled}
                          onClick={() => setPoseModalOpen(true)}
                        />
                      ) : null}
                      {needsAiModel ? (
                        <AddTile
                          label="AI model"
                          icon="workspace"
                          set={aiModelReady}
                          hint="Choose the AI model's look"
                          onClick={() => setAiModelModalOpen(true)}
                        />
                      ) : null}
                    </>
                  )}
                </div>

                <button
                  type="button"
                  className="composer__generate"
                  onClick={() => createMutation.mutate()}
                  disabled={!canSubmit || createMutation.isPending}
                >
                  <span>{createMutation.isPending ? "Generating…" : "Generate"}</span>
                  <Icon name="sparkle" size={16} />
                </button>
              </div>

              <div className="composer__chiprow">
                <ChipSelect
                  icon="workspace"
                  ariaLabel="Model mode"
                  value={modelType}
                  valueLabel={modelLabel(modelType)}
                  options={modelOptions.map((m) => ({ value: m.value, label: m.label }))}
                  onChange={handleModelChange}
                />
                {isVideo ? (
                  <ChipSelect
                    icon="clock"
                    ariaLabel="Duration"
                    value={String(durationSeconds)}
                    valueLabel={`${durationSeconds}s`}
                    options={DURATION_OPTIONS.map((d) => ({
                      value: String(d),
                      label: `${d}s · ${DURATION_HINT[d]}`,
                    }))}
                    onChange={(v) => setDurationSeconds(Number(v))}
                  />
                ) : null}
                <ChipSelect
                  icon="grid"
                  ariaLabel="Aspect ratio"
                  value={aspectRatio}
                  valueLabel={aspectValueLabel(aspectRatio)}
                  options={ASPECT_RATIOS.map((r) => ({
                    value: r,
                    label: aspectValueLabel(r),
                  }))}
                  onChange={setAspectRatio}
                />
                {isVideo ? (
                  <ChipSelect
                    icon="image"
                    ariaLabel="Resolution"
                    value={resolution}
                    valueLabel={resolution}
                    options={RESOLUTIONS.map((r) => ({
                      value: r,
                      label: resolutionLabel(r),
                    }))}
                    onChange={setResolution}
                  />
                ) : null}
                <button
                  type="button"
                  className="composer-chip composer-chip--ghost"
                  onClick={resetAll}
                  aria-label="Reset brief"
                  title="Reset brief"
                >
                  <Icon name="retry" size={15} />
                  <span className="composer-chip__label">Reset</span>
                </button>
              </div>
            </div>
          </div>

          {/* Status line */}
          {comingSoon ? (
            <p className="composer__status">
              <Icon name="info" size={14} />
              {modelLabel(modelType)} isn’t available yet.
            </p>
          ) : missing.length > 0 ? (
            <p className="composer__status">
              <Icon name="info" size={14} />
              Add {missing.join(" and ")} to generate.
            </p>
          ) : (
            <p className="composer__status composer__status--ready">
              <Icon name="check-circle" size={14} />
              Ready to generate.
            </p>
          )}
          {createMutation.isError ? (
            <InlineMessage tone="error">{createMutation.error.message}</InlineMessage>
          ) : null}
        </>
      )}

      {/* Product picker */}
      <Modal
        open={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title="Product"
        description={
          needsProductAngles
            ? "Pick a product and choose which photos to use, then label each with the angle it shows (front, back, left side…). The angle is used to fit the right garment side onto the model."
            : "Pick a product, then choose which of its photos the video is generated from. Selected photos are the candidate frames; for video the model chooses the start and end frames from them."
        }
        footer={
          <Button variant="primary" onClick={() => setProductModalOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="stack stack--sm">
          <FormField label="Product" htmlFor="productId">
            <SelectMenu
              id="productId"
              placeholder="Select a product…"
              value={productId}
              onChange={(v) => setProductId(v)}
              options={(products ?? []).map((product) => ({
                value: product.id,
                label: product.name,
              }))}
            />
          </FormField>

          {productId && productImages.length === 0 ? (
            <InlineMessage tone="error">
              This product has no images. Add images to it before generating.
            </InlineMessage>
          ) : null}

          {productImages.length > 0 ? (
            <>
              <div className="composer__picker-bar">
                <span className="row-link__sub">
                  {selectedImages.length} of {productImages.length} photo
                  {productImages.length === 1 ? "" : "s"} selected
                </span>
                <div className="composer__picker-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedImageIds(productImages.map((a) => a.id))}
                    disabled={selectedImages.length === productImages.length}
                  >
                    Select all
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedImageIds([])}
                    disabled={selectedImages.length === 0}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="grid-cards grid-media">
                {productImages.map((asset) => (
                  <div key={asset.id} className="stack stack--sm">
                    <MediaCard
                      src={asset.cdnUrl}
                      alt="Product image"
                      selected={selectedImageIds.includes(asset.id)}
                      onClick={() => toggleProductImage(asset.id)}
                    />
                    {needsProductAngles ? (
                      <SelectMenu
                        aria-label="Photo angle"
                        placeholder="Select angle…"
                        value={productAngles[asset.id] ?? ""}
                        onChange={(value) => setProductAngle(asset.id, value)}
                        options={ANGLE_SUGGESTIONS.map((a) => ({ value: a, label: a }))}
                        invalid={
                          selectedImageIds.includes(asset.id) &&
                          !(productAngles[asset.id] ?? "").trim()
                        }
                      />
                    ) : null}
                  </div>
                ))}
              </div>
              {selectedImages.length === 0 ? (
                <InlineMessage tone="info">
                  Select at least one photo to generate from.
                </InlineMessage>
              ) : needsProductAngles && !productAnglesLabeled ? (
                <InlineMessage tone="info">
                  Label each selected photo with the angle it shows.
                </InlineMessage>
              ) : null}
            </>
          ) : null}
        </div>
      </Modal>

      {/* Model-pose uploader (Personalized Model) */}
      <Modal
        open={poseModalOpen}
        onClose={() => setPoseModalOpen(false)}
        title="Model poses"
        description="Add your model photos (one or several at a time) and label each with the angle it shows (front, back, left side, right side, front close, back close…). Each pose is virtually fitted with the product; the angle is saved with it."
        footer={
          <Button variant="primary" onClick={() => setPoseModalOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="stack stack--sm">
          {poseSlotsLeft > 0 ? (
            <FileDropzone
              busy={poseUploadMutation.isPending}
              multiple
              maxFiles={poseSlotsLeft}
              onFiles={(files) => files.length > 0 && poseUploadMutation.mutate(files)}
              title="Add model poses"
              hint={`PNG, JPG, WEBP, GIF or AVIF · up to ${poseSlotsLeft} more`}
            />
          ) : (
            <InlineMessage tone="info">
              You’ve added the maximum of {MAX_MODEL_POSES} poses.
            </InlineMessage>
          )}

          {modelPoses.length > 0 ? (
            <>
              <div className="composer__picker-bar">
                <span className="row-link__sub">
                  {modelPoses.length} of {MAX_MODEL_POSES} poses
                </span>
                <Button variant="ghost" size="sm" onClick={() => setModelPoses([])}>
                  Clear all
                </Button>
              </div>

              <div className="grid-cards grid-media">
                {modelPoses.map((pose, i) => (
                  <div key={pose.asset.id} className="stack stack--sm">
                    <MediaCard
                      src={pose.asset.cdnUrl}
                      alt={`Pose ${i + 1}`}
                      onClick={() => removePose(pose.asset.id)}
                      title="Click to remove"
                    />
                    <SelectMenu
                      aria-label={`Pose ${i + 1} angle`}
                      placeholder="Select angle…"
                      value={pose.angle}
                      onChange={(value) => setPoseAngle(pose.asset.id, value)}
                      options={ANGLE_SUGGESTIONS.map((a) => ({ value: a, label: a }))}
                      invalid={!pose.angle.trim()}
                    />
                  </div>
                ))}
              </div>

              {!posesLabeled ? (
                <InlineMessage tone="info">
                  Label each pose with an angle to generate. Click a photo to remove it.
                </InlineMessage>
              ) : (
                <InlineMessage tone="info">Click a photo to remove it.</InlineMessage>
              )}
            </>
          ) : (
            <InlineMessage tone="info">
              Add at least one labeled model pose to generate.
            </InlineMessage>
          )}
        </div>
      </Modal>

      {/* AI-model settings (AI Model) */}
      <Modal
        open={aiModelModalOpen}
        onClose={() => setAiModelModalOpen(false)}
        title="AI model"
        description="Choose the look of the AI-generated model. We generate a fully-clothed model to these specifications, then fit your product onto it."
        footer={
          <Button variant="primary" onClick={() => setAiModelModalOpen(false)}>
            Done
          </Button>
        }
      >
        <div className="stack stack--sm">
          <FormField label="Gender">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {AI_MODEL_GENDERS.map((o) => (
                <ChoiceChip
                  key={o.value}
                  label={o.label}
                  selected={aiModel.gender === o.value}
                  onClick={() => setAiModel((p) => ({ ...p, gender: o.value }))}
                />
              ))}
            </div>
          </FormField>
          <FormField label="Age">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {AI_MODEL_AGES.map((o) => (
                <ChoiceChip
                  key={o.value}
                  label={o.label}
                  selected={aiModel.age === o.value}
                  onClick={() => setAiModel((p) => ({ ...p, age: o.value }))}
                />
              ))}
            </div>
          </FormField>
          <FormField label="Skin tone">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {AI_MODEL_SKIN_TONES.map((o) => (
                <ChoiceChip
                  key={o.value}
                  label={o.label}
                  selected={aiModel.skinTone === o.value}
                  onClick={() => setAiModel((p) => ({ ...p, skinTone: o.value }))}
                />
              ))}
            </div>
          </FormField>
        </div>
      </Modal>

      <AssetPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        selectedId={modelAssetId}
        onSelect={(asset) => setModelAssetId(asset.id)}
        title="Choose a model image"
      />
    </div>
  );
}

/* ----------------------------- Sub-components -------------------------- */

interface ChipOption {
  value: string;
  label: string;
}

/** Theme dropdown styled as a composer chip (icon + current value + caret). */
function ChipSelect({
  icon,
  ariaLabel,
  value,
  valueLabel,
  options,
  onChange,
}: {
  icon: IconName;
  ariaLabel: string;
  value: string;
  valueLabel: string;
  options: ChipOption[];
  onChange: (value: string) => void;
}) {
  return (
    <DropdownMenu
      label={ariaLabel}
      align="start"
      trigger={({ toggle, ref, open }) => (
        <button
          ref={ref}
          type="button"
          className={`composer-chip${open ? " is-open" : ""}`}
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={ariaLabel}
        >
          <Icon name={icon} size={15} />
          <span className="composer-chip__label">{valueLabel}</span>
          <Icon name="chevron-down" size={13} className="composer-chip__caret" />
        </button>
      )}
      items={options.map((option) => ({
        label: option.label,
        selected: option.value === value,
        onSelect: () => onChange(option.value),
      }))}
    />
  );
}

/** A single selectable choice, styled via the shared Button primitive so it needs no
 * new CSS. Used for the AI-model gender/age/skin-tone pickers. */
function ChoiceChip({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={selected ? "primary" : "secondary"}
      size="sm"
      onClick={onClick}
      aria-pressed={selected}
    >
      {label}
    </Button>
  );
}

/** Right-hand "add" tile (Product / Model), mirroring the reference composer. */
function AddTile({
  label,
  icon,
  set,
  thumb,
  disabled,
  required,
  hint,
  onClick,
}: {
  label: string;
  icon: IconName;
  set?: boolean;
  thumb?: string | null;
  disabled?: boolean;
  required?: boolean;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`composer-tile${set ? " is-set" : ""}${required ? " is-required" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={hint}
      aria-label={`${label}${set ? " (set)" : ""}`}
    >
      <span className="composer-tile__media">
        {thumb ? (
          <img src={thumb} alt="" className="composer-tile__thumb" />
        ) : (
          <Icon name={set ? icon : "plus"} size={18} />
        )}
        {set ? (
          <span className="composer-tile__check" aria-hidden="true">
            <Icon name="check" size={11} />
          </span>
        ) : null}
      </span>
      <span className="composer-tile__label">{label}</span>
    </button>
  );
}
