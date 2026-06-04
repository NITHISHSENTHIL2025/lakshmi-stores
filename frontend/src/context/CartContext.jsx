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
  const [offers, setOffers] = useState([]); 

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

  // 🚨 MULTIPLIER PRICING ENGINE 🚨
  const cartSubtotal = cartItems.reduce((total, item) => total + Number(item.price) * item.quantity, 0);
  let totalDiscount = 0;

  const itemsInCombos = new Set();

  offers.filter(o => o.type === 'COMBO').forEach(offer => {
    const comboItemsInCart = cartItems.filter(item => offer.targetProductIds.includes(item.id));
    const alreadyDiscounted = comboItemsInCart.some(item => itemsInCombos.has(item.id));

    if (comboItemsInCart.length === offer.targetProductIds.length && !alreadyDiscounted) {
      
      // 🚨 THE BUG FIX: Check the minimum quantity to apply the combo multiple times!
      const numCombos = Math.min(...comboItemsInCart.map(item => item.quantity));

      const comboOriginalPrice = comboItemsInCart.reduce((sum, item) => sum + Number(item.price), 0);
      if (comboOriginalPrice > offer.comboPrice) {
         // Multiply the discount savings by the number of combos in the cart
         totalDiscount += (comboOriginalPrice - offer.comboPrice) * numCombos;
         offer.targetProductIds.forEach(id => itemsInCombos.add(id));
      }
    }
  });

  offers.filter(o => o.type === 'DISCOUNT').forEach(offer => {
    cartItems.forEach(item => {
      if (offer.targetProductIds.includes(item.id) && !itemsInCombos.has(item.id)) {
        totalDiscount += (Number(item.price) * item.quantity) * (offer.discountPercentage / 100);
      }
    });
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