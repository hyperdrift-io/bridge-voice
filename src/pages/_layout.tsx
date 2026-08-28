import '../styles.css';

import type { ReactNode } from 'react';

type RootLayoutProps = { children: ReactNode };

export default async function RootLayout({ children }: RootLayoutProps) {
  return (
    <>
      <meta
        name="description"
        content="Bridge Voice — speak, and a live fleet of apps moves. Built on the AssemblyAI Voice Agent API."
      />
      <main>{children}</main>
      <footer>
        <p>
          Hyperdrift · AssemblyAI Voice Agent Hackathon, September 2026 ·{' '}
          <a href="https://github.com/hyperdrift-io/bridge-voice">source</a>
        </p>
      </footer>
    </>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
