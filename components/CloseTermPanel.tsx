"use client";

// Side panel (registrar): close a term's accounts. Every enrollment with a
// balance gets a "carried forward" row, and the balance shows up as
// "Previous balance" on the student's next-term enrollment.

import { useEffect, useState } from "react";
import type { ClosePreview, DataStore } from "@/lib/data/store";
import { termLabel } from "@/lib/data/store";
import type { Term } from "@/lib/enrollment/types";
import { peso } from "@/lib/fees";
import { Button, Field, inputClass } from "./ui";

export default function CloseTermPanel({ store, onDone }: { store: DataStore; onDone: (msg: string) => void }) {
  const [terms, setTerms] = useState<Term[]>([]);
  const [termId, setTermId] = useState("");
  const [preview, setPreview] = useState<ClosePreview | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void store.listAllTerms().then((t) => {
      const open = t.filter((x) => !x.closed_at);
      setTerms(open);
      if (open[0]) setTermId(open[0].id);
    });
  }, [store]);

  useEffect(() => {
    if (!termId) return;
    setPreview(null);
    setSure(false);
    void store.previewTermClose(termId).then(setPreview);
  }, [termId, store]);

  const close = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await store.closeTerm(termId);
      onDone(`Term closed. ${r.closed} ${r.closed === 1 ? "balance" : "balances"} carried forward (${peso(r.total)}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!terms.length) return <p className="text-sm text-muted">No open terms to close.</p>;

  return (
    <div className="space-y-4" data-testid="close-term">
      <Field label="Term to close">
        <select data-testid="close-term-select" className={inputClass} value={termId} onChange={(ev) => setTermId(ev.target.value)}>
          {terms.map((t) => (
            <option key={t.id} value={t.id}>{termLabel(t)}</option>
          ))}
        </select>
      </Field>

      <p className="text-sm text-muted">
        Closing posts a <strong>carried forward</strong> row on each ledger below, so the term ends at zero, and a{" "}
        <strong>Previous balance</strong> on the student&apos;s next-term enrollment. If there is no next-term enrollment
        yet, it is added when one is made. After closing, the term takes no more payments, discounts or load changes.
      </p>

      {!preview ? (
        <p className="text-sm text-muted">Checking balances</p>
      ) : preview.error ? (
        <p className="text-sm text-danger">{preview.error}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm" data-testid="close-preview">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Student</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 font-medium">Carried to</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/70">
                {preview.items.map((i) => (
                  <tr key={i.enrollment_id}>
                    <td className="px-3 py-2">{i.student_name}</td>
                    <td className="num px-3 py-2 text-right">{peso(i.amount)}</td>
                    <td className="px-3 py-2 text-muted">{i.next_label ?? "Next enrollment (when made)"}</td>
                  </tr>
                ))}
                {preview.items.length === 0 && (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-muted">No balances. Closing only locks the term.</td></tr>
                )}
              </tbody>
              {preview.items.length > 0 && (
                <tfoot>
                  <tr className="border-t border-line font-semibold">
                    <td className="px-3 py-2">{preview.items.length} accounts</td>
                    <td className="num px-3 py-2 text-right">{peso(preview.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" checked={sure} onChange={(ev) => setSure(ev.target.checked)} data-testid="close-term-sure" />
            I checked the list. Close {preview.label}. This cannot be undone.
          </label>
          {error && <p className="text-sm font-medium text-danger" role="alert">{error}</p>}
          <Button variant="danger" disabled={!sure || busy} onClick={close} data-testid="close-term-confirm">
            {busy ? "Closing" : `Close ${preview.label}`}
          </Button>
        </>
      )}
    </div>
  );
}
