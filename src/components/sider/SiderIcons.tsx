import type { ReactNode } from 'react'

const Outline = ({ children }: { children: ReactNode }) => (
  <svg
    width={16}
    height={16}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.35}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const ChatOutline = () => (
  <Outline>
    <path d="M5 2.75h6A2.5 2.5 0 0 1 13.5 5.25v4A2.5 2.5 0 0 1 11 11.75H7L3.25 14v-2.75a2.5 2.5 0 0 1-.75-2v-4A2.5 2.5 0 0 1 5 2.75Z" />
    <path d="M5.5 6.25h5m-5 2.5h3" />
  </Outline>
)

export const ScanOutline = () => (
  <Outline>
    <path d="M5.5 2.5h-2a1 1 0 0 0-1 1v2m8-3h2a1 1 0 0 1 1 1v2m0 5v2a1 1 0 0 1-1 1h-2m-5 0h-2a1 1 0 0 1-1-1v-2M5.25 6.5h5.5m-5.5 3h5.5" />
  </Outline>
)

export const BellOutline = () => (
  <Outline>
    <path d="M5 6a3 3 0 0 1 6 0c0 2.5.55 3.65 1.5 4.75h-9C4.45 9.65 5 8.5 5 6Zm1.5 7a1.7 1.7 0 0 0 3 0" />
  </Outline>
)

export const WorkflowOutline = () => (
  <Outline>
    <rect x="6.25" y="2" width="3.5" height="3.5" rx=".7" />
    <rect x="2.25" y="10.5" width="3.5" height="3.5" rx=".7" />
    <rect x="10.25" y="10.5" width="3.5" height="3.5" rx=".7" />
    <path d="M8 5.5v2.75M4 10.5V8.25h8v2.25" />
  </Outline>
)

export const HistoryOutline = () => (
  <Outline>
    <circle cx="8" cy="8" r="5.65" />
    <path d="M8 4.75v3.5l2.25 1.25" />
  </Outline>
)
