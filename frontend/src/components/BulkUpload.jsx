import React, { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, FileText, X, Download, Check } from "lucide-react";
import { api, formatApiErrorDetail } from "../lib/api";
import { Modal } from "./UI";

/**
 * Reusable CSV upload dialog.
 * props:
 *  - title (string)
 *  - endpoint (string) e.g. "/items/bulk-upload"
 *  - templateName (string) e.g. "items_template.csv"
 *  - templateHeaders (string[])
 *  - templateExample (string[][])
 *  - instructions (react node)
 *  - onClose (fn)
 *  - onSuccess (fn) - called with result
 *  - testid (string)
 */
export function BulkUploadDialog({
  title,
  endpoint,
  templateName,
  templateHeaders,
  templateExample = [],
  instructions,
  onClose,
  onSuccess,
  testid = "bulk-upload",
}) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);

  const readPreview = (f) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target.result;
      const lines = text.split(/\r?\n/).slice(0, 6).filter(Boolean);
      setPreview(lines);
    };
    reader.readAsText(f);
  };

  const pickFile = (f) => {
    if (!f) return;
    if (!/\.(csv|txt)$/i.test(f.name)) {
      toast.error("File must be CSV format");
      return;
    }
    setFile(f);
    setResult(null);
    readPreview(f);
  };

  const downloadTemplate = () => {
    const rows = [templateHeaders.join(","), ...templateExample.map((r) => r.join(","))];
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = templateName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const submit = async () => {
    if (!file) return toast.error("Please select a CSV file first");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await api.post(endpoint, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(data);
      toast.success("Upload processed successfully");
      if (onSuccess) onSuccess(data);
    } catch (err) {
      toast.error(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal title={title} eyebrow="Upload CSV" onClose={onClose}>
      <div className="upload-body" data-testid={`${testid}-dialog`}>
        <div className="upload-instructions">
          <p className="eyebrow">Required column format</p>
          <div className="upload-headers">
            {templateHeaders.map((h) => (
              <span key={h} className="chip small">
                {h}
              </span>
            ))}
          </div>
          {instructions && <div className="upload-note">{instructions}</div>}
          <button
            type="button"
            className="text-button"
            data-testid={`${testid}-template-download`}
            onClick={downloadTemplate}
          >
            <Download size={14} /> Download CSV template
          </button>
        </div>

        <div
          className={`dropzone ${file ? "has-file" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pickFile(e.dataTransfer.files?.[0]);
          }}
          data-testid={`${testid}-dropzone`}
        >
          <Upload size={22} />
          <strong>{file ? file.name : "Click or drag a CSV file here"}</strong>
          <span>.csv format, maximum 5 MB</span>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            data-testid={`${testid}-file-input`}
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          {file && (
            <button
              type="button"
              className="chip small danger"
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                setPreview([]);
                setResult(null);
              }}
            >
              <X size={12} /> Delete
            </button>
          )}
        </div>

        {preview.length > 0 && (
          <div className="upload-preview" data-testid={`${testid}-preview`}>
            <p className="eyebrow">Preview of first 5 rows</p>
            <pre>{preview.join("\n")}</pre>
          </div>
        )}

        {result && (
          <div className="upload-result" data-testid={`${testid}-result`}>
            <p className="eyebrow">Result</p>
            <div className="result-summary">
              {"created" in result && (
                <span className="chip green small">
                  <Check size={12} /> {result.created} new
                </span>
              )}
              {"updated" in result && result.updated > 0 && (
                <span className="chip blue small">{result.updated} updated</span>
              )}
              {result.errors?.length > 0 && (
                <span className="chip amber small">{result.errors.length} error</span>
              )}
            </div>
            {result.errors?.length > 0 && (
              <ul className="error-list">
                {result.errors.slice(0, 10).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={!file || uploading}
            onClick={submit}
            data-testid={`${testid}-submit`}
          >
            <FileText size={16} /> {uploading ? "Processing..." : "Upload & Process"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
