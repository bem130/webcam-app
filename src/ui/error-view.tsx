type ErrorViewProps = Readonly<{ message: string; onRetry: () => void }>;

export function ErrorView({ message, onRetry }: ErrorViewProps) {
  return (
    <section class="error-card material" aria-labelledby="camera-error-title">
      <h1 id="camera-error-title">カメラを利用できません</h1>
      <p role="alert">{message}</p>
      <button class="primary-button" type="button" onClick={onRetry}>カメラを再開</button>
    </section>
  );
}
