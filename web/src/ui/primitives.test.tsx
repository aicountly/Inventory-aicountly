import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Package } from 'lucide-react'
import { Badge } from './Badge'
import { Button } from './Button'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { SegmentedControl } from './SegmentedControl'
import { StatCard } from './StatCard'
import { StatusBadge } from './StatusBadge'
import { cx } from './cx'

describe('cx', () => {
  it('joins the truthy parts and drops the rest', () => {
    expect(cx('a', false, undefined, null, 'b')).toBe('a b')
    expect(cx()).toBe('')
  })
})

describe('Button', () => {
  it('renders its label and fires onClick', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is disabled and marked busy while loading', () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    )
    const button = screen.getByRole('button')
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    fireEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('defaults to type=button so it never submits a form by accident', () => {
    render(<Button>Go</Button>)
    expect(screen.getByRole('button').getAttribute('type')).toBe('button')
  })

  it('carries the scoped-preflight class', () => {
    render(<Button>Go</Button>)
    expect(screen.getByRole('button').classList.contains('aic')).toBe(true)
  })
})

describe('Badge', () => {
  it('falls back to the neutral tone for an unknown one', () => {
    render(<Badge>Plain</Badge>)
    expect(screen.getByText('Plain').className).toContain('bg-gray-100')
  })
})

describe('StatusBadge', () => {
  it('maps an Inventory status to its tone', () => {
    render(<StatusBadge value="pending_approval" />)
    const el = screen.getByText('Pending approval')
    expect(el.className).toContain('amber')
  })

  it('accepts the Books prop name as well', () => {
    render(<StatusBadge status="posted" />)
    expect(screen.getByText('Posted').className).toContain('emerald')
  })

  it('accepts the legacy good / critical tone names', () => {
    render(<StatusBadge value="anything" tone="critical" />)
    expect(screen.getByText('Anything').className).toContain('red')
  })

  it('humanises a status it does not know', () => {
    render(<StatusBadge value="some_new_state" />)
    expect(screen.getByText('Some new state')).toBeTruthy()
  })

  it('prefers an explicit label', () => {
    render(<StatusBadge value="posted" label="Sent to Books" />)
    expect(screen.getByText('Sent to Books')).toBeTruthy()
  })
})

describe('StatCard', () => {
  const renderCard = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>)

  it('shows no delta when there is no previous figure — the designed fallback', () => {
    renderCard(<StatCard label="Items" value="1,204" current={1204} />)
    expect(screen.queryByText(/%$/)).toBeNull()
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('shows the hint instead of a delta when only a hint is given', () => {
    renderCard(<StatCard label="Items" value="1,204" hint="as at today" />)
    expect(screen.getByText('as at today')).toBeTruthy()
  })

  it('computes the delta when a previous figure is supplied', () => {
    renderCard(<StatCard label="Items" value="120" current={120} previous={100} />)
    expect(screen.getByText('+20.0%')).toBeTruthy()
  })

  it('treats a fall as good when the metric is inverted', () => {
    const { container } = renderCard(
      <StatCard label="Expired" value="5" current={5} previous={10} invertDelta />,
    )
    expect(screen.getByText('-50.0%')).toBeTruthy()
    expect(container.querySelector('.text-emerald-600')).toBeTruthy()
  })

  it('becomes a link with an accessible name when given a target', () => {
    renderCard(
      <StatCard label="Negative stock" value="3" icon={Package} to="/stock?negative=1" />,
    )
    const link = screen.getByRole('link', { name: 'Open Negative stock' })
    expect(link.getAttribute('href')).toBe('/stock?negative=1')
  })

  it('is not a link without a target', () => {
    renderCard(<StatCard label="Negative stock" value="3" />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('reddens a negative value when asked', () => {
    const { container } = renderCard(
      <StatCard label="Variance" value="-12" current={-12} emphasizeNegative />,
    )
    expect(container.querySelector('.text-red-600')).toBeTruthy()
  })
})

describe('EmptyState', () => {
  it('renders a title and description', () => {
    render(<EmptyState title="No documents" description="Post one to see it here." />)
    expect(screen.getByText('No documents')).toBeTruthy()
    expect(screen.getByText('Post one to see it here.')).toBeTruthy()
  })

  it('turns a string action into a button', () => {
    const onAction = vi.fn()
    render(<EmptyState title="No documents" action="New document" onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: 'New document' }))
    expect(onAction).toHaveBeenCalledOnce()
  })
})

describe('ErrorState', () => {
  it('is announced as an alert and offers a retry', () => {
    const onRetry = vi.fn()
    render(<ErrorState description="Timed out." onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})

describe('SegmentedControl', () => {
  const options = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
  ] as const

  it('marks the selected option and reports a change', () => {
    const onChange = vi.fn()
    render(<SegmentedControl value="all" options={options} onChange={onChange} />)
    expect(screen.getByRole('tab', { name: 'All' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Open' }))
    expect(onChange).toHaveBeenCalledWith('open')
  })

  it('does not re-report the option that is already selected', () => {
    const onChange = vi.fn()
    render(<SegmentedControl value="all" options={options} onChange={onChange} />)
    fireEvent.click(screen.getByRole('tab', { name: 'All' }))
    expect(onChange).not.toHaveBeenCalled()
  })
})
