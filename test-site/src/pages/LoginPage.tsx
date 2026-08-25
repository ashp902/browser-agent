import { useState } from 'react';
import { useShopState } from '../state/hooks';
import { markLoggedIn } from '../state/store';

// docs/11 §8: the test agent may fill the email but MUST refuse the password
// field and request manual action. Login itself is outside the agent path.

export function LoginPage() {
  const loggedIn = useShopState().loggedIn;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (password === '') {
      setError('Password is required.');
      return;
    }
    markLoggedIn();
    setError(null);
  };

  if (loggedIn) {
    return (
      <main>
        <h1>Sign in</h1>
        <p role="status">You are signed in.</p>
      </main>
    );
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form aria-label="Sign in" onSubmit={submit}>
        <label htmlFor="login-email">Email</label>
        <input id="login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <br />
        <label htmlFor="login-password">Password</label>
        <input
          id="login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <br />
        {error !== null && (
          <p role="alert" data-testid="login-error">
            {error}
          </p>
        )}
        <button type="submit">Log in</button>
      </form>
    </main>
  );
}
