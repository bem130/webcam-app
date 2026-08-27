import type { JSX } from "preact";

type IconProps = Readonly<{ class?: string }>;

function Svg({ children, class: className }: IconProps & Readonly<{ children: JSX.Element | JSX.Element[] }>) {
  return <svg class={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{children}</svg>;
}

export const CameraIcon = (props: IconProps) => <Svg {...props}><path d="M7.2 5.5 8.6 3h6.8l1.4 2.5H20a2 2 0 0 1 2 2v10.2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h3.2ZM12 17a4.3 4.3 0 1 0 0-8.6A4.3 4.3 0 0 0 12 17Zm0-1.8a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" /></Svg>;
export const ChevronIcon = (props: IconProps) => <Svg {...props}><path d="m7 9 5 5 5-5 1.4 1.4L12 16.8l-6.4-6.4L7 9Z" /></Svg>;
export const SwapIcon = (props: IconProps) => <Svg {...props}><path d="M7.2 7H18l-2.7-2.7 1.4-1.4L21.8 8l-5.1 5.1-1.4-1.4L18 9H7.2A3.2 3.2 0 0 0 4 12.2H2A5.2 5.2 0 0 1 7.2 7Zm9.6 10H6l2.7 2.7-1.4 1.4L2.2 16l5.1-5.1 1.4 1.4L6 15h10.8a3.2 3.2 0 0 0 3.2-3.2h2a5.2 5.2 0 0 1-5.2 5.2Z" /></Svg>;
export const CloseIcon = (props: IconProps) => <Svg {...props}><path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4 6.4 5Z" /></Svg>;
export const CopyIcon = (props: IconProps) => <Svg {...props}><path d="M8 2h11a3 3 0 0 1 3 3v11h-2V5a1 1 0 0 0-1-1H8V2ZM5 7h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V10a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V10a1 1 0 0 0-1-1H5Z" /></Svg>;
export const TrashIcon = (props: IconProps) => <Svg {...props}><path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-2 6h12l-1 12H7L6 9Zm3.2 2 .6 8h4.4l.6-8H9.2Z" /></Svg>;
