import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { ProductsPage } from './pages/ProductsPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderDetailPage } from './pages/OrderDetailPage';
import { AccountPage } from './pages/AccountPage';
import { LoginPage } from './pages/LoginPage';
import { useShopState } from './state/hooks';

// Reference test site routes (docs/11 §3).

export function App() {
  const cart = useShopState().cart;
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <BrowserRouter>
      <nav aria-label="Primary">
        <Link to="/products">Products</Link> | <Link to="/cart">Cart ({cartCount})</Link> |{' '}
        <Link to="/orders">Orders</Link> | <Link to="/account">Account</Link> |{' '}
        <Link to="/login">Sign in</Link>
      </nav>
      <hr />
      <Routes>
        <Route path="/" element={<ProductsPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<CheckoutPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </BrowserRouter>
  );
}
