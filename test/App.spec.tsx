/**
 * App-level tests for the Director's Cut watch-party screen.
 *
 * The real screen depends on two native-capable modules that don't exist in the
 * Jest harness, so both are mocked:
 *  - `@amazon-devices/react-native-w3cmedia` (its import immediately demands the
 *    `KeplerW3CMediaTurboModule` native module)
 *  - `src/lib/mse-player` (drives real MediaSource/SourceBuffer plumbing)
 *
 * `src/lib/ai` is mocked to fall straight to the deterministic local trivia
 * generator, keeping the test offline and reproducible.
 */
import 'react-native';
import {render} from '@testing-library/react-native';
import * as React from 'react';
import {App} from '../src/App';

jest.mock('@amazon-devices/react-native-w3cmedia', () => {
  const React = require('react');
  const {View} = require('react-native');
  const Video = (props: Record<string, unknown>) =>
    React.createElement(View, {testID: 'video-surface', ...props});
  return {
    __esModule: true,
    Video,
    MediaSource: class MockMediaSource {
      static isTypeSupported() {
        return true;
      }
      state = 'closed';
      addEventListener() {}
      removeEventListener() {}
    },
    SourceBuffer: class MockSourceBuffer {},
  };
});

jest.mock('../src/lib/mse-player', () => ({
  __esModule: true,
  playFmp4ViaMse: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/lib/ai', () => {
  const {localTrivia} = jest.requireActual('../src/lib/local-trivia');
  return {
    __esModule: true,
    fetchTrivia: jest.fn().mockImplementation((req: Parameters<typeof localTrivia>[0]) =>
      Promise.resolve(localTrivia(req)),
    ),
    fetchCaptions: jest.fn().mockResolvedValue(''),
  };
});

// The screen polls the engine on mount; stub fetch so tests stay offline.
(globalThis as {fetch: unknown}).fetch = jest
  .fn()
  .mockRejectedValue(new Error('offline (test stub)'));

describe('App — Director\'s Cut', () => {
  it('renders the video surface', () => {
    const screen = render(<App />);
    expect(screen.getByTestId('video-surface')).toBeTruthy();
  });

  it('renders all three critic bots', () => {
    const screen = render(<App />);
    expect(screen.getByText(/Rascal/)).toBeTruthy();
    expect(screen.getByText(/Frank/)).toBeTruthy();
    expect(screen.getByText(/Gimera/)).toBeTruthy();
  });

  it('renders the AI trivia panel branding', () => {
    const screen = render(<App />);
    expect(screen.getByText(/Director.s Cut AI/)).toBeTruthy();
  });

  it('boot scores every bot at 0', () => {
    const screen = render(<App />);
    expect(screen.getByText(/Rascal · 0/)).toBeTruthy();
    expect(screen.getByText(/Frank · 0/)).toBeTruthy();
    expect(screen.getByText(/Gimera · 0/)).toBeTruthy();
  });
});
