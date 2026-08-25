import { useState } from 'react';
import { saveAccount } from '../state/store';
import { useShopState } from '../state/hooks';

// docs/11 §11: account profile form. Policy classification of Save is decided
// by site fixture metadata tests in later milestones; generic inference stays
// conservative.

export function AccountPage() {
  const saved = useShopState().accountSaved;
  const [fullName, setFullName] = useState('Ashish Kumar');
  const [email, setEmail] = useState('ash@example.com');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    saveAccount();
  };

  return (
    <main>
      <h1>Account</h1>
      <form aria-label="Profile" onSubmit={submit}>
        <fieldset>
          <legend>Contact details</legend>
          <label htmlFor="acc-name">Full name</label>
          <input id="acc-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          <br />
          <label htmlFor="acc-email">Email</label>
          <input id="acc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <br />
          <label htmlFor="acc-phone">Phone</label>
          <input id="acc-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <br />
          <label htmlFor="acc-address">Shipping address</label>
          <input id="acc-address" value={address} onChange={(e) => setAddress(e.target.value)} />
        </fieldset>
        <button type="submit">Save</button>
      </form>
      {saved && (
        <p role="status" data-testid="account-saved">
          Profile saved.
        </p>
      )}
    </main>
  );
}
