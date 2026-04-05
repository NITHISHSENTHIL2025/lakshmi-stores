import { createContext, useState, useContext, useEffect } from 'react';

const CartContext = createContext();

export const useCart = () => useContext(CartContext);

export const CartProvider = ({ children }) => {
  // 🚨 FIXED: Initialize state directly from localStorage so it survives a refresh
  const [cartItems, setCartItems] = useState(() => {
    const savedCart = localStorage.getItem('lakshmi_cart');
    return savedCart ? JSON.parse(savedCart) : [];
  });
  const [isCartOpen, setIsCartOpen] = useState(false);

  // 🚨 FIXED: Auto-save to localStorage every time the cart changes
  useEffect(() => {
    localStorage.setItem('lakshmi_cart', JSON.stringify(cartItems));
  }, [cartItems]);

  const addToCart = (product, quantity = 1, maxStock = 99) => {
    setCartItems((prevItems) => {
      const existingItem = prevItems.find((item) => item.id === product.id);
      if (existingItem) {
        const newQty = Math.min(existingItem.quantity + quantity, maxStock);
        return prevItems.map((item) =>
          item.id === product.id ? { ...item, quantity: newQty, maxStock } : item
        );
      }
      return [...prevItems, { ...product, quantity: Math.min(quantity, maxStock), maxStock }];
    });
    setIsCartOpen(true); 
  };

  const removeFromCart = (productId) => {
    setCartItems((prevItems) => prevItems.filter((item) => item.id !== productId));
  };

  const updateQuantity = (productId, newQuantity) => {
    if (newQuantity <= 0) return removeFromCart(productId);
    setCartItems((prevItems) =>
      prevItems.map((item) => {
        if (item.id === productId) {
          const limit = item.maxStock || item.stock || 99;
          return { ...item, quantity: Math.min(newQuantity, limit) };
        }
        return item;
      })
    );
  };

  const clearCart = () => {
    setCartItems([]);
    localStorage.removeItem('lakshmi_cart');
  };

  const cartTotal = cartItems.reduce((total, item) => total + (Number(item.price) * item.quantity), 0).toFixed(2);
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