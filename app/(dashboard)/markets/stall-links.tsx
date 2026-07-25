import { headers } from "next/headers";
import QRCode from "qrcode-svg";
import { CopyLinkButton } from "./copy-link-button";

// Hands the stall links to whoever is working the table: they scan, they're in.
//
// The QR is rendered server-side to an inline SVG — no client library, nothing
// to hydrate, and it prints sharp at any size. Deliberately black-on-white
// regardless of the app's dark theme: phone cameras want that contrast, and a
// green-on-black QR is unreliable to scan in daylight.

function qrSvg(content: string): string {
  return new QRCode({
    content,
    padding: 2,
    width: 220,
    height: 220,
    color: "#000000",
    background: "#ffffff",
    // Medium correction survives a thumb partly covering a phone screen.
    ecl: "M",
  })
    .svg()
    // Strip the XML prolog so the markup can be inlined in JSX.
    .replace(/<\?xml[^>]*\?>/, "");
}

async function originFromRequest(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function StallLinks() {
  const token = process.env.MARKET_LINK_TOKEN;

  if (!token) {
    return (
      <div className="rounded-lg border border-line bg-surface p-4">
        <p className="label-caps text-ink/60">Stall links</p>
        <p className="mt-1 text-sm text-ink/50">
          Set <span className="font-mono text-ink/70">MARKET_LINK_TOKEN</span> in{" "}
          <span className="font-mono text-ink/70">.env.local</span> to enable the shareable POS and
          rifas links.
        </p>
      </div>
    );
  }

  const origin = await originFromRequest();
  const links = [
    {
      key: "pos",
      title: "Roupa · POS",
      blurb: "Sell garments. Stock and prices come from Shopify.",
      url: `${origin}/s/${token}/pos`,
    },
    {
      key: "rifas",
      title: "Rifas",
      blurb: "Quick-add raffle tickets, two taps.",
      url: `${origin}/s/${token}/rifas`,
    },
  ];

  return (
    <details className="group rounded-lg border border-line bg-surface p-4">
      <summary className="label-caps flex cursor-pointer list-none items-center justify-between text-ink/60">
        <span>Stall links &amp; QR codes</span>
        <span className="text-ink/40 group-open:hidden">Show</span>
        <span className="hidden text-ink/40 group-open:inline">Hide</span>
      </summary>

      <p className="mt-3 text-sm text-ink/50">
        Scan or send these to whoever is working the table. They open just the one screen — no
        access to the rest of the dashboard.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {links.map((link) => (
          <div key={link.key} className="rounded-lg border border-line p-4">
            <p className="font-medium text-bone">{link.title}</p>
            <p className="mb-3 text-xs text-ink/50">{link.blurb}</p>

            <div
              className="mx-auto w-fit rounded-md bg-white p-2"
              // Server-generated from the URL directly above — no user input reaches this.
              dangerouslySetInnerHTML={{ __html: qrSvg(link.url) }}
            />

            <p className="mt-3 break-all font-mono text-[0.7rem] leading-tight text-ink/40">
              {link.url}
            </p>
            <CopyLinkButton url={link.url} />
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-ink/40">
        Anyone with a link can record sales and rifas. Change{" "}
        <span className="font-mono">MARKET_LINK_TOKEN</span> to revoke every link at once.
      </p>
    </details>
  );
}
