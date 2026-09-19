import React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { uploadAssets, type Asset } from "../lib/api";
import { useAssets, useWorkspaceKey } from "../lib/queries";
import { humanizeEnum } from "../lib/format";
import {
  Button,
  EmptyState,
  Modal,
  MediaCard,
  SelectMenu,
  Skeleton,
  StatusBadge,
  useToast,
} from "../components";
import { FileDropzone } from "./_dropzone";
import "./pages.css";

const TYPE_FILTERS = [
  { value: "ALL", label: "All types" },
  { value: "PRODUCT_IMAGE", label: "Product images" },
  { value: "GENERATED_IMAGE", label: "Generated images" },
];

/**
 * Modal asset library that mirrors the Assets tab grid, but in a selection mode.
 * Used by the generation wizard so a model/product image can be chosen without
 * leaving the page. Only READY image assets are selectable.
 */
export function AssetPicker({
  open,
  onClose,
  onSelect,
  selectedId,
  title = "Choose an image",
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (asset: Asset) => void;
  selectedId?: string;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const ws = useWorkspaceKey();
  const { notify } = useToast();
  const { data, isLoading } = useAssets();
  const [typeFilter, setTypeFilter] = React.useState("ALL");

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => uploadAssets(files),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["assets", ws] });
      const [first] = result.assets;
      if (!first) {
        notify({
          tone: "error",
          title: "Upload failed",
          description: result.failures[0]?.message,
        });
        return;
      }
      // Select the first freshly-uploaded image so it can be used immediately.
      onSelect(first);
      notify({
        tone: result.failures.length || result.warnings.length ? "info" : "success",
        title: result.failures.length
          ? `Uploaded ${result.assets.length}, ${result.failures.length} failed`
          : result.assets.length > 1
            ? `Uploaded ${result.assets.length} images`
            : "Upload complete",
        description: result.failures[0]?.message ?? result.warnings[0],
      });
    },
    onError: (error: Error) =>
      notify({ tone: "error", title: "Upload failed", description: error.message }),
  });

  const images = (data ?? []).filter((a) => a.status === "READY" && a.type !== "GENERATED_VIDEO");
  const filtered = typeFilter === "ALL" ? images : images.filter((a) => a.type === typeFilter);

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div style={{ marginBottom: "var(--sp-4)" }}>
        <FileDropzone
          busy={uploadMutation.isPending}
          multiple
          maxFiles={10}
          onFiles={(files) => uploadMutation.mutate(files)}
          title="Upload a new image"
        />
      </div>

      <div style={{ width: 200, marginBottom: "var(--sp-4)" }}>
        <SelectMenu
          value={typeFilter}
          onChange={(value) => setTypeFilter(value)}
          aria-label="Filter by type"
          options={TYPE_FILTERS}
        />
      </div>

      {isLoading ? (
        <div className="grid-cards grid-media">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} style={{ aspectRatio: "1 / 1", borderRadius: "var(--radius-md)" }} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          compact
          icon="assets"
          title="No ready images"
          description="Upload an image above to use it here."
        />
      ) : (
        <div className="grid-cards grid-media">
          {filtered.map((asset) => (
            <MediaCard
              key={asset.id}
              src={asset.cdnUrl}
              alt={`${humanizeEnum(asset.type)} asset`}
              title={humanizeEnum(asset.type)}
              subtitle={
                asset.width && asset.height
                  ? `${asset.width}×${asset.height}`
                  : (asset.mime ?? undefined)
              }
              badge={<StatusBadge status={asset.status} />}
              selected={asset.id === selectedId}
              onClick={() => {
                onSelect(asset);
                onClose();
              }}
            />
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--sp-4)" }}>
        <Button variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
