import { useState, useEffect } from 'react';
import { Sparkles, Tag, Plus, Check } from 'lucide-react';
import api from '../api/axios';
import { useCart } from '../context/CartContext';
import toast from 'react-hot-toast';

const OfferZone = () => {
  const [offers, setOffers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const { addToCart, cartItems } = useCart();

  useEffect(() => {
    const fetchOffersAndProducts = async () => {
      try {
        const [offerRes, prodRes] = await Promise.all([
          api.get('/offers/active'),
          api.get('/products?limit=1000') // Fetch all to map IDs
        ]);
        setOffers(offerRes.data.data || []);
        setProducts(prodRes.data.data || []);
      } catch (error) {
        console.error("Failed to load offers");
      } finally {
        setLoading(false);
      }
    };
    fetchOffersAndProducts();
  }, []);

  const handleAddCombo = (offer) => {
    const targetProducts = products.filter(p => offer.targetProductIds.includes(p.id));
    let outOfStock = false;

    targetProducts.forEach(p => {
      if ((p.real_stock || 0) <= 0) outOfStock = true;
    });

    if (outOfStock) {
      toast.error("One or more items in this combo are out of stock.");
      return;
    }

    targetProducts.forEach(p => addToCart(p, 1, p.real_stock));
    toast.success(`${offer.title} added to cart!`);
  };

  const combos = offers.filter(o => o.type === 'COMBO');
  const discounts = offers.filter(o => o.type === 'DISCOUNT');

  if (loading) return <div className="flex h-[50vh] justify-center items-center font-bold text-gray-400">Loading Offers...</div>;

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 animate-fadeIn">
      <div className="bg-gradient-to-r from-purple-900 to-indigo-900 rounded-[2rem] p-10 md:p-14 text-white shadow-2xl relative overflow-hidden mb-12">
        <div className="relative z-10">
          <span className="bg-white/20 text-white px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest backdrop-blur-md border border-white/20">Exclusive Deals</span>
          <h1 className="text-5xl md:text-7xl font-black mt-4 mb-2 tracking-tighter">Offer Zone.</h1>
          <p className="text-purple-200 font-medium text-lg max-w-md">Bundle items together to unlock massive discounts automatically at checkout.</p>
        </div>
        <div className="absolute -top-20 -right-10 text-[15rem] opacity-20 transform rotate-12">✨</div>
      </div>

      {combos.length > 0 && (
        <div className="mb-16">
          <h2 className="text-3xl font-black text-gray-900 tracking-tight mb-6 flex items-center gap-3">
            <Sparkles className="text-orange-500 w-8 h-8" /> Super Combos
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {combos.map(combo => {
              const comboProducts = products.filter(p => combo.targetProductIds.includes(p.id));
              const originalPrice = comboProducts.reduce((sum, p) => sum + Number(p.price), 0);
              
              return (
                <div key={combo.id} className="bg-white rounded-[2rem] p-8 shadow-[0_0_40px_rgba(234,88,12,0.1)] border border-orange-100 relative overflow-hidden group hover:-translate-y-1 transition-transform">
                  <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-orange-400 to-red-500"></div>
                  
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h3 className="text-2xl font-black text-gray-900">{combo.title}</h3>
                      <p className="text-sm font-bold text-gray-500 mt-1">{combo.description}</p>
                    </div>
                    <div className="bg-red-50 text-red-600 font-black text-sm px-4 py-2 rounded-xl border border-red-200">
                      SAVE ₹{originalPrice - combo.comboPrice}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3 mb-8">
                    {comboProducts.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-xl border border-gray-100">
                        <span className="text-xl">📦</span>
                        <span className="font-bold text-sm text-gray-700">{p.name}</span>
                        {i < comboProducts.length - 1 && <Plus className="w-4 h-4 text-gray-400 ml-2" />}
                      </div>
                    ))}
                  </div>

                  <div className="flex items-end justify-between border-t border-gray-100 pt-6">
                    <div>
                      <p className="text-xs font-black text-gray-400 uppercase tracking-widest line-through mb-1">₹{originalPrice} Original</p>
                      <p className="text-4xl font-black text-orange-600 tracking-tighter">₹{combo.comboPrice}</p>
                    </div>
                    <button onClick={() => handleAddCombo(combo)} className="bg-gray-900 text-white px-8 py-4 rounded-xl font-black hover:bg-black transition-colors shadow-lg cursor-pointer">
                      Add Combo
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {discounts.length > 0 && (
        <div>
          <h2 className="text-3xl font-black text-gray-900 tracking-tight mb-6 flex items-center gap-3">
            <Tag className="text-blue-500 w-8 h-8" /> Flat Discounts
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {discounts.map(discount => (
              <div key={discount.id} className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex flex-col">
                <div className="bg-blue-50 text-blue-700 font-black text-3xl p-4 rounded-2xl inline-block w-fit mb-4">
                  {discount.discountPercentage}% OFF
                </div>
                <h3 className="text-xl font-black text-gray-900 mb-2">{discount.title}</h3>
                <p className="text-sm font-bold text-gray-500 mb-6">{discount.description}</p>
                <div className="mt-auto bg-gray-50 p-4 rounded-xl text-xs font-bold text-gray-500 border border-gray-100">
                  Applies to {discount.targetProductIds.length} items automatically at checkout.
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default OfferZone;