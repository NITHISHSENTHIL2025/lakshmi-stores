import { createContext, useState, useContext, useEffect } from 'react';

const CartContext = createContext();

export const useCart = () => useContext(CartContext);

export const CartProvider = ({ children }) => {
  const [cartItems, setCartItems] = useState(() => {
    try {
      const saved = localStorage.getItem('lakshmi_cart');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [isCartOpen, setIsCartOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('lakshmi_cart', JSON.stringify(cartItems));
  }, [cartItems]);

  const addToCart = (product, quantity = 1, maxStock = 99) => {
    // 🚨 PRODUCTION FIX: Using Boolean Flag instead of string matching
    const qty = product.isSoldByWeight ? Number(quantity) : Math.max(1, Math.round(quantity));

    setCartItems((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        const newQty = Math.min(existing.quantity + qty, maxStock);
        return prev.map((item) =>
          item.id === product.id ? { ...item, quantity: newQty, maxStock } : item
        );
      }
      return [...prev, { ...product, quantity: Math.min(qty, maxStock), maxStock }];
    });
    setIsCartOpen(true);
  };

  const removeFromCart = (productId) => {
    setCartItems((prev) => prev.filter((item) => item.id !== productId));
  };

  const updateQuantity = (productId, newQuantity) => {
    const itemToUpdate = cartItems.find(i => i.id === productId);
    if (!itemToUpdate) return;

    // 🚨 PRODUCTION FIX: Using Boolean Flag
    const qty = itemToUpdate.isSoldByWeight ? Number(newQuantity) : Math.round(newQuantity);

    if (qty <= 0) return removeFromCart(productId);
    
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.id === productId) {
          // 🚨 PRODUCTION FIX: Using ?? instead of || so 0 stock doesn't revert to 99!
          const limit = item.maxStock ?? 99;
          return { ...item, quantity: Math.min(qty, limit) };
        }
        return item;
      })
    );
  };

  const clearCart = () => {
    setCartItems([]);
    localStorage.removeItem('lakshmi_cart');
  };

  const cartTotal = cartItems
    .reduce((total, item) => total + Number(item.price) * item.quantity, 0)
    .toFixed(2);

  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0);

  return (
    <CartContext.Provider value={{
      cartItems, addToCart, removeFromCart, updateQuantity, clearCart,
      cartTotal, cartCount, isCartOpen, setIsCartOpen
    }}>
      {children}
    </CartContext.Provider>
  );
};