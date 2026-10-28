"use client";

// Side panel: the registrar applies a discount or scholarship with a reason.
// Shows what it will take off before saving. Order: item -> group -> total.

import { useMemo, useState } from "react";
import type { DataStore } from "@/lib/data/store";
import type { EnrollmentDetail } from "@/lib/enrollment/types";
import { isSeniorHigh } from "@/lib/enrollment/checks";
import {
  FEE_GROUP_LABEL,
  discountLines,
  isJuniorHigh,
  peso,
  postedLines,
  voucherDiscount,
  type Discount,
  type DiscountKind,
  type DiscountScope,
  type FeeGroup,
} from "@/lib/fees";
import { Button, Field, inputClass } from "./ui";

interface Preset {
  name: string;
  scope: DiscountScope;
  target: string | null;
  kind: DiscountKind;
  value: number;
}

export default function DiscountForm({
  detail,
  store,
  onDone,
}: {
  detail: EnrollmentDetail;
  store: DataStore;
  onDone: (msg: string) => void;
}) {
  const e = detail.enrollment;
  const setup = detail.feeSetup;
  const charges = postedLines(detail.ledger, ["charge"]);
  const groups = [...new Set(charges.map((c) => c.group).filter(Boolean))] as FeeGroup[];

  const presets: Preset[] = [
    { name: "Academic scholarship", scope: "group", target: "tuition", kind: "percent", value: 50 },
    { name: "Sibling discount", scope: "group", target: "tuition", kind: "percent", value: 10 },
    { name: "Employee's child", scope: "total", target: null, kind: "percent", value: 20 },
    { name: "Full payment discount", scope: "group", target: "tuition", kind: "percent", value: 5 },
  ];
  if (e.track === "k12" && setup && !e.esc_voucher) {
    if (isSeniorHigh(e.level) && setup.shs_voucher_amount > 0) {
      presets.push({ name: "SHS voucher", scope: "total", target: null, kind: "amount", value: setup.shs_voucher_amount });
    } else if (isJuniorHigh(e.level) && setup.esc_amount > 0) {
      presets.push({ name: "ESC grant", scope: "total", target: null, kind: "amount", value: setup.esc_amount });
    }
  }

  const [preset, setPreset] = useState(0);
  const [form, setForm] = useState<Preset>(presets[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (i: number) => {
    setPreset(i);
    if (i < presets.length) setForm(presets[i]);
    else setForm({ name: "", scope: "total", target: null, kind: "amount", value: 0 });
  };

  // What this discount would take off, with the existing ones applied in order.
  const preview = useMemo(() => {
    const draft: Discount = {
      id: "__new__", school_id: e.school_id, enrollment_id: e.id, name: form.name || "New discount",
      scope: form.scope, target: form.scope === "total" ? null : form.target, kind: form.kind, value: Number(form.value) || 0,
      reason, applied_by: "", applied_by_name: null, applied_at: "9999", voided_at: null, void_reason: null,
    };
    const v = voucherDiscount(e, setup);
    const live = detail.discounts.filter((d) => !d.voided_at);
    const lines = discountLines(charges, [...(v ? [v] : []), ...live, draft]);
    return lines.find((l) => l.code === "disc:__new__")?.amount ?? 0;
  }, [form, reason, charges, detail.discounts, e, setup]);

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await store.runFeeAction(e.id, {
        type: "apply_discount",
        name: form.name,
        scope: form.scope,
        target: form.scope === "total" ? null : form.target,
        kind: form.kind,
        value: Number(form.value),
        reason,
      });
      if (r.ok) onDone(`${form.name} applied.`);
      else setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Preset>(k: K, v: Preset[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form className="space-y-4" onSubmit={save} data-testid="discount-form">
      <p className="text-sm text-muted">
        Discounts stack in this order: <strong>one fee item</strong>, then <strong>a fee group</strong> (for example tuition only),
        then <strong>the total</strong>. A percent uses what is left at that point.
      </p>

      <Field label="Type">
        <select data-testid="disc-preset" className={inputClass} value={preset} onChange={(ev) => pick(Number(ev.target.value))}>
          {presets.map((p, i) => (
            <option key={p.name} value={i}>{p.name}</option>
          ))}
          <option value={presets.length}>Other (type a name)</option>
        </select>
      </Field>

      <Field label="Name (shows on the statement)">
        <input data-testid="disc-name" className={inputClass} value={form.name} onChange={(ev) => set("name", ev.target.value)} />
      </Field>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-muted">Applies to</legend>
        <div role="radiogroup" className="grid grid-cols-3 rounded-xl bg-paper p-1 text-sm">
          {(["item", "group", "total"] as DiscountScope[]).map((sc) => (
            <button
              key={sc}
              type="button"
              role="radio"
              aria-checked={form.scope === sc}
              onClick={() => setForm((f) => ({ ...f, scope: sc, target: sc === "item" ? charges[0]?.code ?? null : sc === "group" ? groups[0] ?? "tuition" : null }))}
              className={`rounded-lg py-1.5 font-medium ${form.scope === sc ? "bg-surface shadow-sm" : "text-muted"}`}
            >
              {sc === "item" ? "One item" : sc === "group" ? "A group" : "Total"}
            </button>
          ))}
        </div>
      </fieldset>

      {form.scope === "item" && (
        <Field label="Fee item">
          <select className={inputClass} value={form.target ?? ""} onChange={(ev) => set("target", ev.target.value)}>
            {charges.map((c) => (
              <option key={c.code} value={c.code}>{c.label} ({peso(c.amount)})</option>
            ))}
          </select>
        </Field>
      )}
      {form.scope === "group" && (
        <Field label="Fee group">
          <select className={inputClass} value={form.target ?? ""} onChange={(ev) => set("target", ev.target.value)}>
            {groups.map((g) => (
              <option key={g} value={g}>{FEE_GROUP_LABEL[g]}</option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Kind">
          <select className={inputClass} value={form.kind} onChange={(ev) => set("kind", ev.target.value as DiscountKind)}>
            <option value="percent">Percent (%)</option>
            <option value="amount">Fixed amount (₱)</option>
          </select>
        </Field>
        <Field label={form.kind === "percent" ? "Percent" : "Amount (₱)"}>
          <input data-testid="disc-value" className={inputClass} inputMode="decimal" value={String(form.value)} onChange={(ev) => set("value", ev.target.value as unknown as number)} />
        </Field>
      </div>

      <Field label="Reason (saved in the history)">
        <textarea data-testid="disc-reason" className={inputClass} rows={2} value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder="e.g. Dean's lister, 1st sem 2025-2026" />
      </Field>

      <div className="flex items-center justify-between rounded-xl bg-paper p-4 text-sm">
        <span>This discount takes off</span>
        <span className="font-semibold tabular-nums text-brand" data-testid="disc-preview">{peso(preview)}</span>
      </div>

      {error && <p className="text-sm font-medium text-danger" role="alert">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy || !reason.trim() || !form.name.trim()} data-testid="disc-submit">
        Apply discount
      </Button>
    </form>
  );
}
