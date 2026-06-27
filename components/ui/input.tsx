import { type InputHTMLAttributes, type LabelHTMLAttributes } from "react";

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="label-caps block text-ink/60" {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full border border-line bg-surface px-3 py-2 text-bone outline-none placeholder:text-ink/30 focus:border-ink ${className}`}
      {...props}
    />
  );
}
