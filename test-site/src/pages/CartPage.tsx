import { useNavigate } from 'react-router-dom';
import { formatPrice } from '../data/products';
import { removeFromCart, setQuantity } from '../state/store';
import { useShopState } from '../state/hooks';

export function CartPage() {
  const cart = useShopState().cart;
  const navigate = useNavigate();
  const total = cart.reduce((sum, item) => sum + item.price_cents * item.quantity, 0);

  return (
    <main>
      <h1>Cart</h1>
      {cart.length === 0 ? (
        <p>Your cart is empty.</p>
      ) : (
        <>
          <ul aria-label="Cart items">
            {cart.map((item, index) => (
              <li key={`${item.productId}-${item.size}`}>
                {item.productName}, size {item.size} — {formatPrice(item.price_cents)}
                <label>
                  {' '}
                  Qty{' '}
                  <select
                    aria-label={`Quantity for ${item.productName}`}
                    value={String(item.quantity)}
                    onChange={(event) => setQuantity(index, Number.parseInt(event.target.value, 10))}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={String(n)}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>{' '}
                <button onClick={() => removeFromCart(index)}>Remove</button>
              </li>
            ))}
          </ul>
          <p>
            Order total: <strong data-testid="cart-total">{formatPrice(total)}</strong>
          </p>
          {/* docs/11 §6: proceeding is navigation, not a purchase. */}
          <button onClick={() => navigate('/checkout')}>Proceed to checkout</button>
        </>
      )}
    </main>
  );
}
