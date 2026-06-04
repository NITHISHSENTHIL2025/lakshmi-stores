import { createContext, useState, useContext, useEffect } from 'react';
import api from '../api/axios';

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
  const [offers, setOffers] = useState([]); // 🚨 New State for Active Offers

  // Fetch active offers when app loads
  useEffect(() => {
    api.get('/offers/active')
       .then(res => setOffers(res.data.data || []))
       .catch(err => console.error("Failed to load offers", err));
  }, []);

  useEffect(() => {
    localStorage.setItem('lakshmi_cart', JSON.stringify(cartItems));
  }, [cartItems]);

  const addToCart = (product, quantity = 1, maxStock = 99) => {
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
  };

  const removeFromCart = (productId) => {
    setCartItems((prev) => prev.filter((item) => item.id !== productId));
  };

  const updateQuantity = (productId, newQuantity) => {
    const itemToUpdate = cartItems.find(i => i.id === productId);
    if (!itemToUpdate) return;
    const qty = itemToUpdate.isSoldByWeight ? Number(newQuantity) : Math.round(newQuantity);
    if (qty <= 0) return removeFromCart(productId);
    
    setCartItems((prev) =>
      prev.map((item) => {
        if (item.id === productId) {
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

  // 🚨 THE PRICING ENGINE: Calculate Subtotal, Discounts, and Final Total
  const cartSubtotal = cartItems.reduce((total, item) => total + Number(item.price) * item.quantity, 0);
  let totalDiscount = 0;

  // Apply Combos and Discounts
  offers.forEach(offer => {
    if (offer.type === 'COMBO') {
      // Check if all target items for the combo are in the cart
      const comboItemsInCart = cartItems.filter(item => offer.targetProductIds.includes(item.id));
      if (comboItemsInCart.length === offer.targetProductIds.length) {
        // Calculate original price of the combo items
        const comboOriginalPrice = comboItemsInCart.reduce((sum, item) => sum + Number(item.price), 0);
        // Add the savings to the total discount
        if (comboOriginalPrice > offer.comboPrice) {
           totalDiscount += (comboOriginalPrice - offer.comboPrice);
        }
      }
    } else if (offer.type === 'DISCOUNT') {
      cartItems.forEach(item => {
        if (offer.targetProductIds.includes(item.id)) {
          totalDiscount += (Number(item.price) * item.quantity) * (offer.discountPercentage / 100);
        }
      });
    }
  });

  const cartTotal = Math.max(0, cartSubtotal - totalDiscount).toFixed(2);
  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0);

  return (
    <CartContext.Provider value={{
      cartItems, addToCart, removeFromCart, updateQuantity, clearCart,
      cartSubtotal: cartSubtotal.toFixed(2), 
      totalDiscount: totalDiscount.toFixed(2),
      cartTotal, cartCount, isCartOpen, setIsCartOpen
    }}>
      {children}
    </CartContext.Provider>
  );
};