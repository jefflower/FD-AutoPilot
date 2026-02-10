import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

// 一个简单的测试组件
function TestComponent({ name }: { name: string }) {
  return <div>Hello, {name}!</div>;
}

describe('TestComponent', () => {
  it('renders the name correctly', () => {
    render(<TestComponent name="World" />);
    expect(screen.getByText('Hello, World!')).toBeInTheDocument();
  });

  it('renders another name', () => {
    render(<TestComponent name="Vitest" />);
    expect(screen.getByText('Hello, Vitest!')).toBeInTheDocument();
  });
});
