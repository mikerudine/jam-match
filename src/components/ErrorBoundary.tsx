import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
  fallbackHint?: string
  reloadLabel?: string
}

interface State {
  error: Error | null
}

/** Catches render throws so one bad page does not blank the whole Mini App. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    const title = this.props.fallbackTitle ?? 'Something went wrong'
    const hint =
      this.props.fallbackHint ?? 'Reload the app or go back and try again.'
    const reload = this.props.reloadLabel ?? 'Reload'

    return (
      <div className="mx-auto max-w-lg space-y-3 px-4 py-10 text-center">
        <h1 className="font-display text-xl text-cream">{title}</h1>
        <p className="text-sm text-mute">{hint}</p>
        <p className="break-words text-xs text-mute/80">
          {this.state.error.message}
        </p>
        <button
          type="button"
          className="rounded-xl bg-teal px-4 py-2.5 text-sm font-semibold text-ink"
          onClick={() => {
            this.setState({ error: null })
            window.location.reload()
          }}
        >
          {reload}
        </button>
      </div>
    )
  }
}
