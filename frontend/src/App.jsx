import { BrowserRouter as Router, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';

// API & Contexts
import { StoreProvider, useStore } from './context/StoreContext';
import { CartProvider, useCart } from './context/CartContext';
import { AuthProvider, useAuth } from './context/AuthContext'; 

// Components
import ProductGrid from './components/ProductGrid';
import CartSlider from './components/CartSlider';
import Login from './pages/Login';
import AdminDashboard from './pages/AdminDashboard';
import MyAccount from './pages/MyAccount';
import MyOrders from './pages/MyOrders';
import PaymentStatus from './pages/PaymentStatus';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword'; 
import VerifyOTP from './pages/VerifyOTP';

const ProtectedAdminRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || user.role !== 'admin') return <Navigate to="/login" replace />;
  return children;
};

const ProtectedCustomerRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  
  // 🚨 STRICT ROLE FIX: Instantly bounce Admins out of customer-only pages
  if (user.role === 'admin') return <Navigate to="/admin" replace />;
  
  return children;
};

const TopNav = () => {
  const { cartCount, setIsCartOpen } = useCart();
  const { user } = useAuth();
  
  return (
    <nav className="bg-white shadow-sm p-4 sticky top-0 z-40 border-b border-gray-100">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-2xl font-black text-gray-900 tracking-tighter hover:opacity-80 transition">
            Lakshmi<span className="text-orange-600">Stores</span>
          </Link>
          <div className="hidden md:flex flex-col ml-4 border-l border-gray-200 pl-4">
            <span className="text-[10px] font-bold text-orange-600 uppercase tracking-widest">Pickup Store</span>
            <span className="text-sm font-black text-gray-900 flex items-center gap-1">🏪 Lakshmi Stores, Main Counter</span>
          </div>
        </div>

        <div className="flex gap-4 md:gap-6 items-center">
          <Link to="/" className="hidden md:block font-bold text-gray-600 hover:text-orange-600 transition-colors">Store</Link>
          
          {user?.role === 'customer' ? (
            <>
              <Link to="/orders" className="hidden md:flex items-center gap-2 font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 px-4 py-2 rounded-xl transition-colors"><span>📦</span> Live Orders</Link>
              <Link to="/account" className="hidden md:flex items-center gap-2 font-bold text-gray-900 hover:text-orange-600 bg-gray-50 px-4 py-2 rounded-xl transition-colors"><span className="text-xl">👤</span> {user.name?.split(' ')[0] || 'User'}</Link>
            </>
          ) : user?.role === 'admin' ? (
             <Link to="/admin" className="hidden md:block bg-gray-900 text-white px-5 py-2 rounded-xl font-bold hover:bg-black transition-all cursor-pointer">Dashboard</Link>
          ) : (
            <Link to="/login" className="hidden md:block bg-orange-50 text-orange-600 px-5 py-2 rounded-xl font-bold hover:bg-orange-100 transition-all cursor-pointer">Login / Register</Link>
          )}

          <button onClick={() => setIsCartOpen(true)} className="relative p-2 text-gray-900 hover:text-orange-600 transition cursor-pointer bg-gray-50 rounded-full h-12 w-12 flex items-center justify-center transform hover:scale-105">
            <span className="text-xl">🛍️</span>
            {cartCount > 0 && <span className="absolute -top-1 -right-1 bg-orange-600 text-white text-xs font-black w-6 h-6 flex items-center justify-center rounded-full shadow-md animate-bounce">{cartCount}</span>}
          </button>
        </div>
      </div>
    </nav>
  );
};

const BottomNav = () => {
  const location = useLocation();
  const { user } = useAuth();
  const isActive = (path) => location.pathname === path ? "text-orange-600" : "text-gray-400";

  return (
    <div className="md:hidden fixed bottom-0 left-0 w-full bg-white border-t border-gray-200 shadow-[0_-5px_20px_rgba(0,0,0,0.05)] z-40 flex justify-around items-center pb-safe pt-2 px-2 h-16">
      <Link to="/" className={`flex flex-col items-center gap-1 w-1/3 ${isActive('/')}`}><span className="text-xl">🏠</span><span className="text-[10px] font-black tracking-wider uppercase">Store</span></Link>
      
      {/* 🚨 STRICT ROLE FIX: Hide these tabs entirely from Admins */}
      {user?.role === 'customer' && (
        <>
          <Link to="/orders" className={`flex flex-col items-center gap-1 w-1/3 border-l border-gray-100 ${isActive('/orders')}`}><span className="text-xl">📦</span><span className="text-[10px] font-black tracking-wider uppercase">Orders</span></Link>
          <Link to="/account" className={`flex flex-col items-center gap-1 w-1/3 border-l border-gray-100 ${isActive('/account')}`}><span className="text-xl">👤</span><span className="text-[10px] font-black tracking-wider uppercase">Account</span></Link>
        </>
      )}
    </div>
  );
};

// 🚨 PRODUCTION FIX: Using Global Store Context
const CustomerLayout = ({ children }) => {
  const { storeStatus, statusLoading } = useStore();

  if (statusLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
         <div className="animate-spin h-12 w-12 border-4 border-orange-600 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-20 md:pb-0 relative">
      {!storeStatus.isOpen && (
        <div className="fixed inset-0 z-[99999] bg-gray-900/95 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center w-full h-full animate-fadeIn">
          <div className="text-8xl mb-8 animate-bounce">🏪</div>
          <h2 className="text-5xl font-black text-white mb-4 tracking-tighter">Shop is Closed</h2>
          <p className="text-gray-400 font-bold mb-8 max-w-sm text-lg">We are currently taking a break or closed for the day. Please come back later!</p>
        </div>
      )}
      
      {storeStatus.isOpen && storeStatus.closingWarningActive && (
        <div className="bg-red-600 text-white p-3 text-center text-sm font-black tracking-wide uppercase animate-pulse shadow-md z-50">
          ⚠️ Attention: Shop is closing soon. Final orders must be placed immediately!
        </div>
      )}
      
      <TopNav />
      <main className="flex-grow max-w-7xl mx-auto w-full p-4 md:mt-6">
        {children}
      </main>
      <BottomNav />
    </div>
  );
};

function App() {
  return (
    <Router>
      <StoreProvider>
        <AuthProvider>
          <CartProvider>
            <Toaster 
              position="top-center" 
              toastOptions={{
                style: { borderRadius: '16px', background: '#111827', color: '#fff', fontWeight: '900', padding: '16px 24px' },
                error: { style: { background: '#ef4444', color: '#fff' } },
                success: { style: { background: '#22c55e', color: '#fff' } }
              }}
            />
            <div className="font-sans text-gray-900 bg-gray-50 min-h-screen">
              <CartSlider />
              <Routes>
                <Route path="/admin/*" element={<ProtectedAdminRoute><AdminDashboard /></ProtectedAdminRoute>} />
                <Route path="/login" element={<Login />} /> 
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password/:token" element={<ResetPassword />} /> 
                <Route path="/verify-otp" element={<VerifyOTP />} />
                <Route path="/payment-status" element={<CustomerLayout><PaymentStatus /></CustomerLayout>} />
                <Route path="/" element={<CustomerLayout><ProductGrid /></CustomerLayout>} />
                <Route path="/account" element={<ProtectedCustomerRoute><CustomerLayout><MyAccount /></CustomerLayout></ProtectedCustomerRoute>} />
                <Route path="/orders" element={<ProtectedCustomerRoute><CustomerLayout><MyOrders /></CustomerLayout></ProtectedCustomerRoute>} />
              </Routes>
            </div>
          </CartProvider>
        </AuthProvider>
      </StoreProvider>
    </Router>
  );
}

export default App;