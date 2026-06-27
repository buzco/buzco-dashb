import { type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary";

// Storefront buttons: sharp 0px corners, no rounding. Primary is hot-pink
// (#E0207B) with black text; secondary is an outlined green ghost button.
const VARIANT_STYLES: Record<Variant, string> = {
  primary: "bg-pink text-black hover:opacity-90",
  secondary: "border border-ink/60 text-ink hover:border-ink hover:bg-ink/10",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`label-caps rounded-md px-4 py-2 transition-opacity disabled:opacity-50 ${VARIANT_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}
