"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { shopifyCdnResize } from "@/lib/shopify/image";
import {
  logSaleOrder,
  createCustomer,
  type SaleOrderState,
} from "@/lib/actions/sales";
import type { SaleProductView, SaleVariantView } from "@/lib/sales/catalog";

// The till. Built for a phone held in one hand at a market or in a shop's back
// room: pictures rather than SKUs, one question per screen, and nothing that
// needs a keyboard until the very end.
//
// The cart is React state and posts as one object, because an order is one
// transaction — four tees to the same buyer is a single Shopify order, a single
// Notion-visible reference and a single row of money, not four unrelated sales.

export type CustomerOption = { id: string; name: string; email: string | null; location: string | null };

type CartLine = {
  variantId: string;
  productId: string;
  productName: string;
  imageUrl: string | null;
  sku: string;
  size: string | null;
  color: string | null;
  unitPrice: number;
  quantity: number;
  freebie: boolean;
  available: number;
};

const STEPS = ["Items", "Where", "Customer", "Payment", "Confirm"] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4;

function euro(n: number): string {
  return `€${n.toFixed(2)}`;
}

function sizeLabel(v: { size: string | null; color: string | null; sku: string }): string {
  return v.size ?? v.color ?? v.sku;
}

export function SaleWizard({
  products,
  customers,
  whereOptions,
  paymentOptions,
  optionsAreLive,
  notionConfigured,
  shopifyConfigured,
}: {
  products: SaleProductView[];
  customers: CustomerOption[];
  whereOptions: string[];
  paymentOptions: string[];
  optionsAreLive: boolean;
  notionConfigured: boolean;
  shopifyConfigured: boolean;
}) {
  const [step, setStep] = useState<StepIndex>(0);
  const [kind, setKind] = useState<"sale" | "consignment">("sale");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [sizingProduct, setSizingProduct] = useState<SaleProductView | null>(null);
  const [query, setQuery] = useState("");

  const [where, setWhere] = useState<string>("");
  const [retailerId, setRetailerId] = useState<string>("");
  const [customerName, setCustomerName] = useState<string>("");
  const [paymentStatus, setPaymentStatus] = useState<"paid" | "pending">("paid");
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [discountKind, setDiscountKind] = useState<"percent" | "amount" | null>(null);
  const [discountValue, setDiscountValue] = useState<string>("");
  const [notes, setNotes] = useState<string>("");

  const [customerList, setCustomerList] = useState(customers);
  const [result, setResult] = useState<SaleOrderState | null>(null);
  const [pending, startTransition] = useTransition();

  const isConsignment = kind === "consignment";

  const visibleProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.variants.some((v) => v.sku.toLowerCase().includes(q)),
    );
  }, [products, query]);

  const subtotal = useMemo(
    () => cart.reduce((n, l) => n + (l.freebie ? 0 : l.unitPrice * l.quantity), 0),
    [cart],
  );
  const discountAmount = useMemo(() => {
    const value = Number(discountValue.replace(",", "."));
    if (!discountKind || !Number.isFinite(value) || value <= 0) return 0;
    return Math.min(subtotal, discountKind === "percent" ? (subtotal * value) / 100 : value);
  }, [discountKind, discountValue, subtotal]);
  const total = Math.max(0, subtotal - discountAmount);
  const units = cart.reduce((n, l) => n + l.quantity, 0);

  // How many of this size are already committed, so the picker can stop at what
  // Shopify actually has rather than letting the order fail at the end.
  function inCart(variantId: string): number {
    return cart.find((l) => l.variantId === variantId)?.quantity ?? 0;
  }

  function addVariant(product: SaleProductView, variant: SaleVariantView) {
    setCart((prev) => {
      const existing = prev.find((l) => l.variantId === variant.variantId);
      if (existing) {
        if (existing.quantity >= variant.available) return prev;
        return prev.map((l) =>
          l.variantId === variant.variantId ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          variantId: variant.variantId,
          productId: product.productId,
          productName: product.name,
          imageUrl: product.imageUrl,
          sku: variant.sku,
          size: variant.size,
          color: variant.color,
          unitPrice: variant.price ?? product.price ?? 0,
          quantity: 1,
          freebie: false,
          available: variant.available,
        },
      ];
    });
  }

  function updateLine(variantId: string, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)));
  }

  function removeLine(variantId: string) {
    setCart((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  const customer = customerList.find((c) => c.id === retailerId) ?? null;
  const buyerLabel = customer?.name ?? customerName.trim() ?? "";

  // What stops each step being "Next"-able. Kept as a function rather than
  // disabling the button silently, so the reason can be shown.
  function blocker(at: StepIndex): string | null {
    if (at === 0 && !cart.length) return "Add at least one item";
    if (at === 1 && !where && !isConsignment) return "Pick where it was sold";
    if (at === 2 && isConsignment && !retailerId) return "A consignation needs a customer";
    if (at === 3 && !isConsignment && paymentStatus === "paid" && !paymentMethod) {
      return "Pick how they paid";
    }
    return null;
  }

  function submit() {
    startTransition(async () => {
      const state = await logSaleOrder({
        kind,
        retailerId: retailerId || null,
        customerName: customer ? customer.name : customerName.trim() || null,
        where: where || null,
        paymentStatus: isConsignment ? "pending" : paymentStatus,
        paymentMethod: isConsignment ? null : paymentMethod || null,
        discountKind,
        discountValue: Number(discountValue.replace(",", ".")) || 0,
        notes: notes.trim() || null,
        lines: cart.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          freebie: l.freebie,
        })),
      });
      setResult(state);
    });
  }

  function reset() {
    setCart([]);
    setStep(0);
    setResult(null);
    setDiscountKind(null);
    setDiscountValue("");
    setNotes("");
    setCustomerName("");
    setRetailerId("");
    setPaymentMethod("");
    setPaymentStatus("paid");
    setKind("sale");
  }

  if (result?.ok) {
    return <Receipt result={result} kind={kind} onNext={reset} />;
  }

  return (
    <div className="pb-36">
      <StepBar step={step} onJump={(s) => cart.length && setStep(s)} isConsignment={isConsignment} />

      {step === 0 && (
        <ItemsStep
          products={visibleProducts}
          query={query}
          onQuery={setQuery}
          inCart={inCart}
          onPick={setSizingProduct}
          hasProducts={products.length > 0}
        />
      )}

      {step === 1 && (
        <WhereStep
          kind={kind}
          onKind={setKind}
          where={where}
          onWhere={setWhere}
          options={whereOptions}
          optionsAreLive={optionsAreLive}
        />
      )}

      {step === 2 && (
        <CustomerStep
          required={isConsignment}
          customers={customerList}
          retailerId={retailerId}
          onRetailer={setRetailerId}
          customerName={customerName}
          onCustomerName={setCustomerName}
          onCreated={(c) => {
            setCustomerList((prev) => [...prev, c].sort((a, b) => a.name.localeCompare(b.name)));
            setRetailerId(c.id);
          }}
        />
      )}

      {step === 3 && (
        <PaymentStep
          isConsignment={isConsignment}
          status={paymentStatus}
          onStatus={setPaymentStatus}
          method={paymentMethod}
          onMethod={setPaymentMethod}
          options={paymentOptions}
          optionsAreLive={optionsAreLive}
        />
      )}

      {step === 4 && (
        <ConfirmStep
          cart={cart}
          kind={kind}
          where={where}
          buyer={buyerLabel}
          paymentStatus={isConsignment ? "pending" : paymentStatus}
          paymentMethod={isConsignment ? "Consignation" : paymentMethod}
          discountKind={discountKind}
          discountValue={discountValue}
          onDiscountKind={setDiscountKind}
          onDiscountValue={setDiscountValue}
          notes={notes}
          onNotes={setNotes}
          onLine={updateLine}
          onRemove={removeLine}
          subtotal={subtotal}
          discountAmount={discountAmount}
          total={total}
          notionConfigured={notionConfigured}
          shopifyConfigured={shopifyConfigured}
        />
      )}

      {sizingProduct && (
        <Sheet onClose={() => setSizingProduct(null)}>
          <SizePicker
            product={sizingProduct}
            inCart={inCart}
            onAdd={(v) => addVariant(sizingProduct, v)}
            onDone={() => setSizingProduct(null)}
          />
        </Sheet>
      )}

      <BottomBar
        step={step}
        units={units}
        total={total}
        pending={pending}
        blocker={blocker(step)}
        error={result?.error}
        isConsignment={isConsignment}
        onBack={() => setStep((s) => Math.max(0, s - 1) as StepIndex)}
        onNext={() => setStep((s) => Math.min(4, s + 1) as StepIndex)}
        onSubmit={submit}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 0 — what's being sold
// ---------------------------------------------------------------------------

function ItemsStep({
  products,
  query,
  onQuery,
  inCart,
  onPick,
  hasProducts,
}: {
  products: SaleProductView[];
  query: string;
  onQuery: (q: string) => void;
  inCart: (variantId: string) => number;
  onPick: (p: SaleProductView) => void;
  hasProducts: boolean;
}) {
  if (!hasProducts) {
    return (
      <p className="text-sm text-ink/50">
        Nothing in stock to sell.{" "}
        <Link href="/shopify" className="text-ink underline">
          Run a Shopify sync
        </Link>{" "}
        to pull inventory in.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search a product or SKU…"
        className="w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-bone outline-none placeholder:text-ink/30 focus:border-ink"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {products.map((product) => {
          const picked = product.variants.reduce((n, v) => n + inCart(v.variantId), 0);
          return (
            <button
              key={product.productId}
              type="button"
              onClick={() => onPick(product)}
              className={`flex flex-col overflow-hidden rounded-lg border text-left transition-colors ${
                picked ? "border-ink bg-ink/5" : "border-line bg-surface hover:border-ink/50"
              }`}
            >
              <div className="relative aspect-square w-full bg-ink/5">
                {product.imageUrl ? (
                  <Image
                    src={shopifyCdnResize(product.imageUrl, 600)!}
                    alt={product.name}
                    fill
                    sizes="(max-width:640px) 50vw, 25vw"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <span className="label-caps text-ink/30">No image</span>
                  </div>
                )}
                {picked > 0 && (
                  <span className="absolute right-2 top-2 rounded-full bg-pink px-2 py-0.5 font-mono text-sm text-black">
                    {picked}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <p className="text-sm font-medium leading-tight text-bone">{product.name}</p>
                <p className="font-mono text-base tabular-nums text-ink">
                  {product.price != null ? euro(product.price) : "—"}
                </p>
                <p className="label-caps mt-auto text-ink/40">{product.available} in stock</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Size is asked once per add, not once per product: a shop taking two smalls
 * and a large is three taps here, and the stock figure on each chip is the live
 * Shopify count minus whatever is already in this cart.
 */
function SizePicker({
  product,
  inCart,
  onAdd,
  onDone,
}: {
  product: SaleProductView;
  inCart: (variantId: string) => number;
  onAdd: (v: SaleVariantView) => void;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-bone">{product.name}</p>
          <p className="label-caps text-ink/50">Pick a size — tap again to add another</p>
        </div>
        <button type="button" onClick={onDone} className="label-caps text-ink/60">
          Done
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {product.variants.map((v) => {
          const taken = inCart(v.variantId);
          const left = v.available - taken;
          return (
            <button
              key={v.variantId}
              type="button"
              disabled={left <= 0}
              onClick={() => onAdd(v)}
              className={`rounded-lg border px-2 py-4 transition-colors ${
                left <= 0
                  ? "border-line text-ink/25 line-through"
                  : taken > 0
                    ? "border-ink bg-ink/10 text-ink"
                    : "border-line text-bone hover:border-ink/60"
              }`}
            >
              <span className="block text-lg font-medium">{sizeLabel(v)}</span>
              <span className="label-caps block font-mono text-ink/50">
                {left} left{taken > 0 ? ` · ${taken} in cart` : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — sale or consignation, and where
// ---------------------------------------------------------------------------

function WhereStep({
  kind,
  onKind,
  where,
  onWhere,
  options,
  optionsAreLive,
}: {
  kind: "sale" | "consignment";
  onKind: (k: "sale" | "consignment") => void;
  where: string;
  onWhere: (w: string) => void;
  options: string[];
  optionsAreLive: boolean;
}) {
  return (
    <div className="space-y-8">
      <Question title="What is this?">
        <div className="grid grid-cols-2 gap-3">
          <BigChoice
            selected={kind === "sale"}
            onClick={() => onKind("sale")}
            title="Sale"
            hint="Money in now"
          />
          <BigChoice
            selected={kind === "consignment"}
            onClick={() => onKind("consignment")}
            title="Consignation"
            hint="Goods out, paid later"
          />
        </div>
        {kind === "consignment" && (
          <p className="mt-3 text-sm text-ink/50">
            It will be logged as payment pending and can only be marked paid from the
            Consignations tab.
          </p>
        )}
      </Question>

      <Question
        title="Where was it sold?"
        hint={optionsAreLive ? "Live from Notion" : "Notion unreachable — showing the last known list"}
      >
        <ChipGrid options={options} value={where} onChange={onWhere} />
      </Question>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — who bought it
// ---------------------------------------------------------------------------

function CustomerStep({
  required,
  customers,
  retailerId,
  onRetailer,
  customerName,
  onCustomerName,
  onCreated,
}: {
  required: boolean;
  customers: CustomerOption[];
  retailerId: string;
  onRetailer: (id: string) => void;
  customerName: string;
  onCustomerName: (n: string) => void;
  onCreated: (c: CustomerOption) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    startTransition(async () => {
      const res = await createCustomer(newName, newEmail || null);
      if (res.error || !res.id) {
        setError(res.error ?? "Could not create that customer");
        return;
      }
      onCreated({ id: res.id, name: res.name ?? newName, email: newEmail || null, location: null });
      setCreating(false);
      setNewName("");
      setNewEmail("");
      setError(null);
    });
  }

  return (
    <div className="space-y-8">
      <Question
        title={required ? "Which shop is it going to?" : "Who bought it?"}
        hint={required ? "Required for a consignation" : "Optional"}
      >
        <div className="space-y-2">
          {customers.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onRetailer(retailerId === c.id ? "" : c.id)}
              className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                retailerId === c.id
                  ? "border-ink bg-ink/10 text-ink"
                  : "border-line text-bone hover:border-ink/50"
              }`}
            >
              <span className="truncate font-medium">{c.name}</span>
              <span className="label-caps shrink-0 text-ink/40">{c.location ?? c.email ?? ""}</span>
            </button>
          ))}

          {creating ? (
            <div className="space-y-2 rounded-lg border border-ink/60 p-4">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Shop / customer name"
                className="w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-bone outline-none placeholder:text-ink/30 focus:border-ink"
              />
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Email (optional)"
                inputMode="email"
                className="w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-bone outline-none placeholder:text-ink/30 focus:border-ink"
              />
              {error && <p className="text-sm text-status-cancelled">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={create}
                  disabled={pending || !newName.trim()}
                  className="label-caps flex-1 rounded-md bg-pink px-4 py-3 text-black disabled:opacity-50"
                >
                  {pending ? "Saving…" : "Save customer"}
                </button>
                <button
                  type="button"
                  onClick={() => setCreating(false)}
                  className="label-caps rounded-md border border-line px-4 py-3 text-ink/70"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="label-caps w-full rounded-lg border border-dashed border-ink/40 px-4 py-4 text-ink/70 hover:border-ink hover:text-ink"
            >
              + New customer
            </button>
          )}
        </div>
      </Question>

      {!required && (
        <Question title="Or just a name" hint="For a walk-up buyer with no customer record">
          <input
            value={customerName}
            onChange={(e) => onCustomerName(e.target.value)}
            placeholder="Name on the receipt"
            disabled={Boolean(retailerId)}
            className="w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-bone outline-none placeholder:text-ink/30 focus:border-ink disabled:opacity-40"
          />
        </Question>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — money
// ---------------------------------------------------------------------------

function PaymentStep({
  isConsignment,
  status,
  onStatus,
  method,
  onMethod,
  options,
  optionsAreLive,
}: {
  isConsignment: boolean;
  status: "paid" | "pending";
  onStatus: (s: "paid" | "pending") => void;
  method: string;
  onMethod: (m: string) => void;
  options: string[];
  optionsAreLive: boolean;
}) {
  if (isConsignment) {
    return (
      <Question title="Payment">
        <div className="rounded-lg border border-status-ordered/50 bg-status-ordered/5 p-5">
          <p className="label-caps text-status-ordered">Payment pending</p>
          <p className="mt-2 text-sm text-ink/70">
            A consignation can&apos;t be logged as paid. It goes out as pending here, as{" "}
            <span className="text-bone">Por pagar</span> in Notion and as an unpaid order in
            Shopify. Mark it paid from the Consignations tab once the shop settles up.
          </p>
        </div>
      </Question>
    );
  }

  return (
    <div className="space-y-8">
      <Question title="Has it been paid?">
        <div className="grid grid-cols-2 gap-3">
          <BigChoice
            selected={status === "paid"}
            onClick={() => onStatus("paid")}
            title="Paid"
            hint="Money in hand"
          />
          <BigChoice
            selected={status === "pending"}
            onClick={() => onStatus("pending")}
            title="Pending"
            hint="Owes us"
          />
        </div>
      </Question>

      {status === "paid" && (
        <Question
          title="Paid with what?"
          hint={optionsAreLive ? "Live from Notion" : "Notion unreachable — showing the last known list"}
        >
          <ChipGrid options={options} value={method} onChange={onMethod} />
        </Question>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — discounts, freebies, notes, and the final look
// ---------------------------------------------------------------------------

function ConfirmStep({
  cart,
  kind,
  where,
  buyer,
  paymentStatus,
  paymentMethod,
  discountKind,
  discountValue,
  onDiscountKind,
  onDiscountValue,
  notes,
  onNotes,
  onLine,
  onRemove,
  subtotal,
  discountAmount,
  total,
  notionConfigured,
  shopifyConfigured,
}: {
  cart: CartLine[];
  kind: "sale" | "consignment";
  where: string;
  buyer: string;
  paymentStatus: "paid" | "pending";
  paymentMethod: string;
  discountKind: "percent" | "amount" | null;
  discountValue: string;
  onDiscountKind: (k: "percent" | "amount" | null) => void;
  onDiscountValue: (v: string) => void;
  notes: string;
  onNotes: (n: string) => void;
  onLine: (variantId: string, patch: Partial<CartLine>) => void;
  onRemove: (variantId: string) => void;
  subtotal: number;
  discountAmount: number;
  total: number;
  notionConfigured: boolean;
  shopifyConfigured: boolean;
}) {
  return (
    <div className="space-y-8">
      <Question title="The order">
        <div className="space-y-2">
          {cart.map((line) => (
            <div
              key={line.variantId}
              className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3"
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-ink/5">
                {line.imageUrl && (
                  <Image
                    src={shopifyCdnResize(line.imageUrl, 200)!}
                    alt={line.productName}
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-bone">{line.productName}</p>
                <p className="label-caps text-ink/50">{sizeLabel(line)}</p>
                <div className="mt-1 flex items-center gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    inputMode="decimal"
                    value={line.freebie ? 0 : line.unitPrice}
                    disabled={line.freebie}
                    onChange={(e) => onLine(line.variantId, { unitPrice: Number(e.target.value) })}
                    className="w-20 rounded-md border border-line bg-surface px-2 py-1 font-mono text-sm tabular-nums text-bone outline-none focus:border-ink disabled:opacity-40"
                  />
                  <button
                    type="button"
                    onClick={() => onLine(line.variantId, { freebie: !line.freebie })}
                    className={`label-caps rounded-full border px-2 py-1 ${
                      line.freebie
                        ? "border-pink text-pink"
                        : "border-line text-ink/50 hover:border-ink/60"
                    }`}
                  >
                    {line.freebie ? "Freebie" : "Free?"}
                  </button>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <QtyButton
                  label="−"
                  onClick={() =>
                    line.quantity <= 1
                      ? onRemove(line.variantId)
                      : onLine(line.variantId, { quantity: line.quantity - 1 })
                  }
                />
                <span className="w-6 text-center font-mono tabular-nums text-bone">
                  {line.quantity}
                </span>
                <QtyButton
                  label="+"
                  disabled={line.quantity >= line.available}
                  onClick={() => onLine(line.variantId, { quantity: line.quantity + 1 })}
                />
              </div>
            </div>
          ))}
        </div>
      </Question>

      <Question title="Discount" hint="Off the whole order">
        <div className="flex flex-wrap items-center gap-2">
          {(["percent", "amount"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onDiscountKind(discountKind === k ? null : k)}
              className={`label-caps rounded-md border px-4 py-3 ${
                discountKind === k
                  ? "border-ink bg-ink/10 text-ink"
                  : "border-line text-ink/60 hover:border-ink/50"
              }`}
            >
              {k === "percent" ? "% off" : "€ off"}
            </button>
          ))}
          {discountKind && (
            <input
              type="number"
              step="0.01"
              min={0}
              inputMode="decimal"
              autoFocus
              value={discountValue}
              onChange={(e) => onDiscountValue(e.target.value)}
              placeholder={discountKind === "percent" ? "10" : "5.00"}
              className="w-28 rounded-md border border-line bg-surface px-3 py-3 font-mono text-lg tabular-nums text-bone outline-none placeholder:text-ink/30 focus:border-ink"
            />
          )}
        </div>
      </Question>

      <Question title="Notes" hint="Goes on the Notion row and the Shopify order">
        <textarea
          value={notes}
          onChange={(e) => onNotes(e.target.value)}
          rows={2}
          placeholder="Anything worth remembering"
          className="w-full rounded-md border border-line bg-surface px-3 py-3 text-base text-bone outline-none placeholder:text-ink/30 focus:border-ink"
        />
      </Question>

      <div className="space-y-2 rounded-lg border border-line bg-surface p-4">
        <SummaryRow label="Type" value={kind === "consignment" ? "Consignation" : "Sale"} />
        {buyer && <SummaryRow label="Customer" value={buyer} />}
        {where && <SummaryRow label="Where" value={where} />}
        <SummaryRow
          label="Payment"
          value={
            kind === "consignment"
              ? "Pending · Consignation"
              : paymentStatus === "paid"
                ? paymentMethod || "Paid"
                : "Pending"
          }
        />
        <div className="my-2 border-t border-line" />
        <SummaryRow label="Subtotal" value={euro(subtotal)} />
        {discountAmount > 0 && (
          <SummaryRow
            label={`Discount${discountKind === "percent" ? ` (${discountValue}%)` : ""}`}
            value={`− ${euro(discountAmount)}`}
          />
        )}
        <SummaryRow label="Total" value={euro(total)} strong />
      </div>

      <p className="text-xs text-ink/40">
        Logging writes to three places: this ledger,{" "}
        {shopifyConfigured ? "a Shopify order" : "Shopify (not configured — skipped)"} and{" "}
        {notionConfigured ? "one Notion page per garment" : "Notion (not configured — skipped)"}.
      </p>
    </div>
  );
}

function Receipt({
  result,
  kind,
  onNext,
}: {
  result: SaleOrderState;
  kind: "sale" | "consignment";
  onNext: () => void;
}) {
  return (
    <div className="mx-auto max-w-md space-y-5 py-10 text-center">
      <p className="text-5xl">✓</p>
      <div>
        <p className="text-lg font-medium text-bone">
          {kind === "consignment" ? "Consignation logged" : "Sale logged"}
        </p>
        <p className="font-mono text-2xl tabular-nums text-ink">{result.reference}</p>
      </div>

      <div className="space-y-1 text-sm text-ink/60">
        {result.shopifyOrderName && <p>Shopify {result.shopifyOrderName}</p>}
        {(result.warnings ?? []).map((w) => (
          <p key={w} className="text-status-ordered">
            {w}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onNext}
          className="label-caps w-full rounded-md bg-pink px-4 py-4 text-black"
        >
          Log another
        </button>
        <Link
          href={kind === "consignment" ? "/sales/consignments" : "/sales"}
          className="label-caps w-full rounded-md border border-ink/60 px-4 py-4 text-ink"
        >
          {kind === "consignment" ? "See consignations" : "Back to sales"}
        </Link>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function StepBar({
  step,
  onJump,
  isConsignment,
}: {
  step: StepIndex;
  onJump: (s: StepIndex) => void;
  isConsignment: boolean;
}) {
  return (
    <ol className="mb-5 flex items-center gap-1 overflow-x-auto">
      {STEPS.map((label, i) => (
        <li key={label} className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onJump(i as StepIndex)}
            className={`label-caps rounded-full px-2.5 py-1 ${
              i === step
                ? "bg-ink/15 text-ink"
                : i < step
                  ? "text-ink/60 hover:text-ink"
                  : "text-ink/25"
            }`}
          >
            {i === 3 && isConsignment ? "Pending" : label}
          </button>
          {i < STEPS.length - 1 && <span className="text-ink/20">›</span>}
        </li>
      ))}
    </ol>
  );
}

function BottomBar({
  step,
  units,
  total,
  pending,
  blocker,
  error,
  isConsignment,
  onBack,
  onNext,
  onSubmit,
}: {
  step: StepIndex;
  units: number;
  total: number;
  pending: boolean;
  blocker: string | null;
  error?: string;
  isConsignment: boolean;
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
}) {
  const last = step === 4;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 p-3 backdrop-blur-sm md:left-56">
      <div className="mx-auto flex max-w-4xl items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="label-caps text-ink/40">
            {units} item{units === 1 ? "" : "s"}
          </p>
          <p className="font-mono text-xl tabular-nums text-bone">{euro(total)}</p>
          {(blocker || error) && (
            <p className={`truncate text-xs ${error ? "text-status-cancelled" : "text-ink/40"}`}>
              {error ?? blocker}
            </p>
          )}
        </div>

        {step > 0 && (
          <button
            type="button"
            onClick={onBack}
            className="label-caps shrink-0 rounded-md border border-line px-4 py-3 text-ink/70"
          >
            Back
          </button>
        )}

        <button
          type="button"
          onClick={last ? onSubmit : onNext}
          disabled={Boolean(blocker) || pending}
          className="label-caps shrink-0 rounded-md bg-pink px-6 py-3 text-black disabled:opacity-40"
        >
          {pending
            ? "Logging…"
            : last
              ? isConsignment
                ? "Log consignation"
                : "Log sale"
              : "Next"}
        </button>
      </div>
    </div>
  );
}

function Question({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold text-bone">{title}</h2>
        {hint && <p className="label-caps text-ink/40">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function BigChoice({
  selected,
  onClick,
  title,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-lg border px-4 py-6 text-left transition-colors ${
        selected ? "border-ink bg-ink/10 text-ink" : "border-line text-bone hover:border-ink/50"
      }`}
    >
      <span className="block text-lg font-medium">{title}</span>
      <span className="label-caps block text-ink/50">{hint}</span>
    </button>
  );
}

function ChipGrid({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(value === o ? "" : o)}
          className={`rounded-lg border px-4 py-3 text-base transition-colors ${
            value === o ? "border-ink bg-ink/10 text-ink" : "border-line text-bone hover:border-ink/50"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function QtyButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-9 w-9 rounded-md border border-line text-lg text-bone disabled:opacity-30"
    >
      {label}
    </button>
  );
}

function SummaryRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="label-caps text-ink/50">{label}</span>
      <span
        className={`font-mono tabular-nums ${strong ? "text-xl text-ink" : "text-sm text-bone"}`}
      >
        {value}
      </span>
    </div>
  );
}

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-auto rounded-t-2xl border border-line bg-surface p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
