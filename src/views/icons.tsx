// The page's icons, drawn inline: rendered into the HTML like everything
// else, so they cost no request, no script and no dependency, and work
// without JavaScript. Always next to words that say the same thing, never
// instead of them, so they're hidden from screen readers.
//
// Icons from IBM's Carbon Design System (https://carbondesignsystem.com),
// @carbon/icons 11.92.0, the set TableKit's React components use, so the
// page matches the TableKit stylesheet. Apache License 2.0,
// Copyright IBM Corp. https://www.apache.org/licenses/LICENSE-2.0
//
// Filled shapes on a 32 × 32 grid; fill="currentColor" follows the text
// colour around them, in light and dark mode.

const paths = {
  hourglass: [
    "M15 19H17V21H15z",
    "M15 23H17V25H15z",
    "M23,11.67V4h3V2H6V4H9v7.67a2,2,0,0,0,.4,1.2L11.75,16,9.4,19.13a2,2,0,0,0-.4,1.2V28H6v2H26V28H23V20.33a2,2,0,0,0-.4-1.2L20.25,16l2.35-3.13A2,2,0,0,0,23,11.67ZM21,4v7H11V4Zm0,16.33V28H11V20.33L14.25,16,12,13h8l-2.25,3Z",
  ],
  bell: [
    "M28.7071,19.293,26,16.5859V13a10.0136,10.0136,0,0,0-9-9.9492V1H15V3.0508A10.0136,10.0136,0,0,0,6,13v3.5859L3.2929,19.293A1,1,0,0,0,3,20v3a1,1,0,0,0,1,1h7v.7768a5.152,5.152,0,0,0,4.5,5.1987A5.0057,5.0057,0,0,0,21,25V24h7a1,1,0,0,0,1-1V20A1,1,0,0,0,28.7071,19.293ZM19,25a3,3,0,0,1-6,0V24h6Zm8-3H5V20.4141L7.707,17.707A1,1,0,0,0,8,17V13a8,8,0,0,1,16,0v4a1,1,0,0,0,.293.707L27,20.4141Z",
  ],
  restaurant: [
    "M9 2H11V12H9z",
    "M14,11a4,4,0,0,1-8,0V2H4v9a6,6,0,0,0,5,5.91V30h2V16.91A6,6,0,0,0,16,11V2H14Z",
    "M22,2H21V30h2V20h3a2,2,0,0,0,2-2V8A5.78,5.78,0,0,0,22,2Zm4,16H23V4.09c2.88.56,3,3.54,3,3.91Z",
  ],
  checkmark: ["M13 24 4 15 5.414 13.586 13 21.171 26.586 7.586 28 9 13 24z"],
  copy: [
    "M28,10V28H10V10H28m0-2H10a2,2,0,0,0-2,2V28a2,2,0,0,0,2,2H28a2,2,0,0,0,2-2V10a2,2,0,0,0-2-2Z",
    "M4,18H2V4A2,2,0,0,1,4,2H18V4H4Z",
  ],
} as const;

export type IconName = keyof typeof paths;

/**
 * One icon. `size`, in CSS pixels, is only the fallback for a page whose
 * stylesheet didn't load: the stylesheet sizes each icon in em, relative to
 * the text beside it. data-icon names it, for the stylesheet and the tests.
 */
export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="currentColor"
    >
      {paths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
