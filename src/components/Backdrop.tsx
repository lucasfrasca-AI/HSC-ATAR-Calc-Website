import { useEffect } from "react";

/** Decorative ambient field + the SVG filter used for glass refraction. */
export function Backdrop() {
  useEffect(() => {
    // backdrop-filter: url(#svg) only renders in Chromium; elsewhere glass stays blur + rim.
    const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands ?? [];
    if (brands.some((b) => b.brand === "Chromium")) document.documentElement.classList.add("can-refract");
  }, []);
  return (
    <>
      <div className="ambient" aria-hidden="true"><i className="a1" /><i className="a2" /><i className="a3" /></div>
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
        <filter id="lg-refract" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.006 0.009" numOctaves="2" seed="7" result="noise" />
          <feGaussianBlur in="noise" stdDeviation="2.5" result="soft" />
          <feDisplacementMap in="SourceGraphic" in2="soft" scale="26" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
    </>
  );
}
