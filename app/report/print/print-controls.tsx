"use client";

export function PrintControls({ scanId, ar }: { scanId: string; ar: boolean }) {
  return <div className="print-controls" dir={ar ? "rtl" : "ltr"}>
    <a href={`/report?scan=${encodeURIComponent(scanId)}`}>{ar ? "العودة إلى التقرير" : "Back to report"}</a>
    <button type="button" onClick={() => window.print()}>{ar ? "طباعة / حفظ PDF" : "Print / save PDF"}</button>
  </div>;
}
