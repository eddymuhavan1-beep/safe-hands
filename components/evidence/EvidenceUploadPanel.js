'use client';

import { useEffect, useMemo } from 'react';

/**
 * Shared evidence file picker with readable typography and previews.
 * @param {{
 *   id?: string;
 *   files: File[];
 *   onChange: (files: File[]) => void;
 *   maxFiles?: number;
 *   label?: string;
 *   helpText?: string;
 *   accept?: string;
 * }} props
 */
export default function EvidenceUploadPanel({
  id = 'evidence-upload',
  files,
  onChange,
  maxFiles = 5,
  label = 'Upload photos',
  helpText = 'JPEG, PNG, or WebP — max 5MB each.',
  accept = 'image/jpeg,image/png,image/webp',
}) {
  const previews = useMemo(
    () =>
      files.map((file) => ({
        file,
        url: URL.createObjectURL(file),
        name: file.name,
        sizeKb: Math.round(file.size / 1024),
      })),
    [files]
  );

  useEffect(() => {
    return () => {
      previews.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, [previews]);

  const handlePick = (e) => {
    const picked = e.target.files ? Array.from(e.target.files) : [];
    onChange(picked.slice(0, maxFiles));
    e.target.value = '';
  };

  const removeAt = (index) => {
    onChange(files.filter((_, i) => i !== index));
  };

  return (
    <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/80 p-4">
      <label htmlFor={id} className="block text-base font-semibold text-slate-900 mb-1">
        {label}
      </label>
      <p className="text-sm text-slate-700 leading-relaxed mb-3">{helpText}</p>
      <p className="text-sm font-medium text-slate-600 mb-3">
        {files.length} of {maxFiles} file{maxFiles === 1 ? '' : 's'} selected
      </p>

      <input
        id={id}
        type="file"
        accept={accept}
        multiple={maxFiles > 1}
        onChange={handlePick}
        className="block w-full text-sm text-slate-800 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-700 cursor-pointer"
      />

      {previews.length > 0 && (
        <ul className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {previews.map((p, index) => (
            <li
              key={`${p.name}-${index}`}
              className="relative rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm"
            >
              <img src={p.url} alt="" className="h-24 w-full object-cover" />
              <div className="p-2">
                <p className="text-xs font-medium text-slate-900 truncate" title={p.name}>
                  {p.name}
                </p>
                <p className="text-xs text-slate-600">{p.sizeKb} KB</p>
              </div>
              <button
                type="button"
                onClick={() => removeAt(index)}
                className="absolute top-1 right-1 rounded-full bg-slate-900/75 text-white text-xs px-2 py-0.5 hover:bg-slate-900"
                aria-label={`Remove ${p.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
