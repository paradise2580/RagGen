import React from "react";
import { Icon } from "../components";
import "./pages.css";

// AVIF is offered even though no provider can read it: uploadAsset() re-encodes it to
// JPEG in the browser before sending (lib/image-normalize.ts). Keep this list and that
// module in step — an entry here with no conversion path would fail at render, which is
// exactly the bug this replaced.
const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif";

/** Accessible click + drag-and-drop image picker. Supports single or batch upload. */
export function FileDropzone({
  onFiles,
  busy,
  multiple = false,
  maxFiles = 1,
  title = "Upload an image",
  hint,
}: {
  onFiles: (files: File[]) => void;
  busy?: boolean;
  multiple?: boolean;
  maxFiles?: number;
  title?: string;
  hint?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const resolvedHint =
    hint ??
    (multiple
      ? `PNG, JPG, WEBP, GIF or AVIF · click or drop up to ${maxFiles} files`
      : "PNG, JPG, WEBP, GIF or AVIF · click or drop a file");

  function handleFiles(fileList: FileList | null) {
    const all = Array.from(fileList ?? []);
    if (all.length === 0) return;
    const limit = multiple ? maxFiles : 1;
    const files = all.slice(0, limit);
    setNotice(
      all.length > limit
        ? `Only the first ${limit} file${limit === 1 ? "" : "s"} were added (${all.length} selected).`
        : null,
    );
    onFiles(files);
  }

  return (
    <div>
      <div
        className={`dropzone${dragging ? " is-dragging" : ""}`}
        role="button"
        tabIndex={0}
        aria-busy={busy || undefined}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <span className="dropzone__icon" aria-hidden="true">
          <Icon name={busy ? "clock" : "upload"} size={22} />
        </span>
        <span className="dropzone__title">{busy ? "Uploading…" : title}</span>
        <span className="dropzone__hint">{resolvedHint}</span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple={multiple}
          className="visually-hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {notice ? (
        <span
          className="dropzone__hint"
          role="status"
          style={{ display: "block", marginTop: "var(--sp-2)" }}
        >
          {notice}
        </span>
      ) : null}
    </div>
  );
}
