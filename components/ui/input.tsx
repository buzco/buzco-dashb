import { type InputHTMLAttributes, type LabelHTMLAttributes } from "react";

export function Label(props: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className="label-caps block text-ink/60" {...props} />;
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full border border-line bg-white px-3 py-2 text-ink outline-none focus:border-ink ${className}`}
      {...props}
    />
  );
}
