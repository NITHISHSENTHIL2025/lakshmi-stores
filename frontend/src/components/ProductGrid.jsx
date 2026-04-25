import { useState, useEffect, useCallback } from 'react';
import { useCart } from '../context/CartContext';
import { useStore } from '../context/StoreContext';
import api from '../api/axios';

const ProductGrid = () => {
  const { storeStatus, socket } = useStore();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // 🚨 PRODUCTION FIX: Swiggy-Level Pagination State
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [requestedItems, setRequestedItems] = useState([]);
  const [notifiedItems, setNotifiedItems] = useState([]);

  const [weightModalProduct, setWeightModalProduct] = useState(null);
  const [customWeight, setCustomWeight] = useState('');

  const { addToCart, cartItems, updateQuantity, removeFromCart, cartTotal, setIsCartOpen } = useCart();

  // 🚨 PRODUCTION FIX: Fetching with Page and Limit
  const fetchCatalog = useCallback(async (pageNum = 1, shouldAppend = false) => {
    try {
      if (pageNum === 1 && !shouldAppend) setLoading(true);
      const res = await api.get(`/products?page=${pageNum}&limit=20`); 
      
      const newProducts = res.data.data;
      setProducts(prev => shouldAppend ? [...prev, ...newProducts] : newProducts);
      setHasMore(res.data.pagination.page < res.data.pagination.pages);
      setPage(pageNum);
    } catch (e) {
      console.error('Failed to load catalog', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCatalog(1, false);

    // If socket exists, listen for store updates
    if (socket) {
      socket.on('storeUpdated', () => fetchCatalog(1, false));
    }
    return () => {
      if (socket) socket.off('storeUpdated');
    };
  }, [socket, fetchCatalog]);

  const loadMore = () => {
    if (hasMore) fetchCatalog(page + 1, true);
  };

  const getAppStock = (product) => {
    const real = product.real_stock || 0;
    const buffer = product.buffer !== undefined ? product.buffer : 2;
    return Math.max(0, real - buffer); 
  };

  const handleAddClick = (product, appStock) => {
    // 🚨 PRODUCTION FIX: Use Boolean Flag
    if (product.isSoldByWeight) setWeightModalProduct({ ...product, appStock });
    else addToCart(product, 1, appStock); 
  };

  const confirmWeightAdd = (weight) => {
    if (weightModalProduct) {
      const requestedWeight = Number(weight);
      if (requestedWeight > weightModalProduct.appStock) {
        alert(`⚠️ Cannot add ${requestedWeight}kg. We only have ${weightModalProduct.appStock}kg available in stock!`);
        return; 
      }
      addToCart(weightModalProduct, requestedWeight, weightModalProduct.appStock);
      setWeightModalProduct(null); 
      setCustomWeight('');
    }
  };

  const handleRequestItem = async () => {
    if (searchQuery.trim() === '') return;
    try {
      await api.post('/store/requests', { itemName: searchQuery });
      setRequestedItems([...requestedItems, searchQuery]);
      setSearchQuery('');
    } catch (e) { }
  };

  const handleNotifyMe = (productId) => {
    setNotifiedItems([...notifiedItems, productId]);
    alert("You will be notified the moment this item arrives!");
  };

  const categories = ['All', 'Combos', ...new Set(products.map(p => p.category).filter(Boolean))];

  const filteredAndSortedProducts = products
    .filter(product => {
      const matchesCategory = activeCategory === 'All' || product.category === activeCategory;
      const matchesSearch = product.name.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    })
    .sort((a, b) => {
      const stockA = getAppStock(a); const stockB = getAppStock(b);
      if (stockA > 0 && stockB === 0) return -1; 
      if (stockA === 0 && stockB > 0) return 1;  
      return 0; 
    });

  const getCartItem = (productId) => cartItems.find(item => item.id === productId);

  if (loading && products.length === 0) return <div className="flex justify-center items-center h-[50vh]"><div className="animate-spin text-5xl">🛒</div></div>;

  return (
    <div className="space-y-6 pb-24 animate-fadeIn relative">
      
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-5 rounded-2xl shadow-sm border border-gray-100 mx-2 md:mx-0 animate-slideUp">
         <div>
           <h1 className="text-3xl font-black text-gray-900 tracking-tight">Lakshmi<span className="text-orange-500">Stores</span></h1>
           <a href="https://www.google.com/maps/search/?api=1&query=Lakshmi+Stores+Grocery" target="_blank" rel="noreferrer" className="text-xs font-bold text-gray-500 flex items-center gap-1 hover:text-blue-500 transition-colors mt-1 cursor-pointer">
             📍 Lakshmi Stores, Main Counter <span className="underline decoration-dotted text-[10px] ml-1">Get Directions</span>
           </a>
         </div>
      </div>

      {weightModalProduct && (
        <div className="fixed inset-0 z-[60] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 transition-opacity duration-300">
          <div className="bg-white rounded-[2rem] p-6 w-full max-w-sm shadow-2xl border border-gray-100 animate-slideUp text-center">
            <h3 className="text-xl font-black text-gray-900 mb-1">{weightModalProduct.name}</h3>
            <p className="text-gray-500 font-bold mb-6">Select Quantity (₹{weightModalProduct.price} / kg)</p>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <button onClick={() => confirmWeightAdd(0.25)} className="py-3 bg-gray-50 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 border border-gray-200 rounded-xl font-black transition cursor-pointer transform hover:scale-105">250g</button>
              <button onClick={() => confirmWeightAdd(0.5)} className="py-3 bg-gray-50 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 border border-gray-200 rounded-xl font-black transition cursor-pointer transform hover:scale-105">500g</button>
              <button onClick={() => confirmWeightAdd(1)} className="py-3 bg-gray-50 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 border border-gray-200 rounded-xl font-black transition cursor-pointer transform hover:scale-105">1 KG</button>
              <button onClick={() => confirmWeightAdd(2)} className="py-3 bg-gray-50 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200 border border-gray-200 rounded-xl font-black transition cursor-pointer transform hover:scale-105">2 KG</button>
            </div>
            <div className="flex gap-2 mb-6">
              <input type="number" step="0.1" placeholder="Custom (kg)" value={customWeight} onChange={e => setCustomWeight(e.target.value)} className="flex-1 border border-gray-200 rounded-xl px-4 font-bold outline-none focus:border-orange-500" />
              <button onClick={() => customWeight && confirmWeightAdd(customWeight)} className="bg-gray-900 text-white px-4 py-2 rounded-xl font-bold hover:bg-black cursor-pointer shadow-md transform hover:scale-105 transition-transform">Add</button>
            </div>
            <button onClick={() => setWeightModalProduct(null)} className="w-full py-3 text-red-500 font-bold hover:bg-red-50 rounded-xl transition cursor-pointer">Cancel</button>
          </div>
        </div>
      )}

      {/* Banner */}
      <div className="bg-gradient-to-r from-orange-600 to-red-500 rounded-[2rem] p-8 md:p-12 text-white shadow-xl shadow-orange-500/20 relative overflow-hidden flex items-center justify-between mx-2 md:mx-0 transition-transform duration-500 hover:scale-[1.01] animate-slideUp delay-100">
        <div className="relative z-10 max-w-sm">
          <span className="bg-white/20 text-white px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest shadow-sm backdrop-blur-sm border border-white/20">Digital Store</span>
          <h2 className="text-4xl md:text-5xl font-black mt-4 mb-2 tracking-tighter leading-tight drop-shadow-md">Skip the Line.</h2>
          <p className="text-orange-100 font-medium text-sm md:text-base drop-shadow-sm">Order on your phone, get your token, and pick up at the counter.</p>
        </div>
        <div className="text-8xl md:text-[10rem] relative z-10 drop-shadow-2xl hidden sm:block transform hover:rotate-12 transition-transform duration-500">🛍️</div>
        <div className="absolute top-[-50px] right-[-50px] w-64 h-64 bg-white opacity-10 rounded-full blur-3xl"></div>
      </div>

      <div className="sticky top-[72px] md:top-[88px] z-30 bg-gray-50/90 backdrop-blur-xl py-4 px-2 md:px-0">
        <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2 px-2">
          {categories.map((category) => (
            <button key={category} onClick={() => setActiveCategory(category)} className={`whitespace-nowrap px-6 py-3 rounded-full font-black text-sm transition-all duration-300 shadow-sm cursor-pointer ${activeCategory === category ? 'bg-gray-900 text-white shadow-lg transform scale-105 border-transparent' : 'bg-white text-gray-600 border border-gray-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200'}`}>
              {category}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden md:block relative max-w-md mx-2 md:mx-0 animate-fadeIn delay-200">
        <input type="text" placeholder="Search for groceries..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-6 py-4 bg-white shadow-sm border border-gray-100 rounded-2xl font-bold text-gray-900 focus:ring-2 focus:ring-orange-500 outline-none pl-12 transition-all hover:shadow-md" />
        <span className="absolute left-4 top-4 text-xl opacity-50">🔍</span>
      </div>

      {filteredAndSortedProducts.length === 0 ? (
        <div className="text-center py-24 bg-white rounded-[2rem] border border-gray-100 mx-2 md:mx-0 shadow-sm animate-fadeIn">
          <div className="text-7xl mb-4 opacity-50">🕵️</div>
          <h3 className="text-2xl font-black text-gray-900 mb-2">Item not found</h3>
          <p className="text-gray-500 font-medium mb-8">We might not stock "{searchQuery}" right now.</p>
          {!requestedItems.includes(searchQuery) ? (
            <button onClick={handleRequestItem} className="bg-gray-900 text-white px-8 py-4 rounded-xl font-black shadow-xl hover:bg-black transition-transform transform hover:-translate-y-1 cursor-pointer">
              Request this Item
            </button>
          ) : ( <span className="bg-green-100 text-green-700 px-6 py-3 rounded-xl font-black">✅ Request Sent to Store!</span> )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 px-2 md:px-0">
          {filteredAndSortedProducts.map((product, index) => {
            const cartItem = getCartItem(product.id);
            const appStock = getAppStock(product); 
            const isOutOfStock = appStock === 0;
            
            // 🚨 PRODUCTION FIX: Use Boolean Flag
            const stepAmount = product.isSoldByWeight ? 0.25 : 1;

            return (
              <div key={product.id} style={{ animationDelay: `${index * 0.05}s` }} className={`bg-white rounded-3xl p-4 shadow-sm border transition-all duration-300 flex flex-col group relative overflow-hidden animate-slideUp ${isOutOfStock ? 'opacity-80 border-gray-50' : 'border-gray-100 hover:shadow-xl hover:-translate-y-1'}`}>
                <div className="bg-gray-50 rounded-2xl h-36 md:h-48 mb-4 flex items-center justify-center overflow-hidden relative border border-gray-100/50 p-2">
                  {product.imageUrl ? <img src={product.imageUrl} className={`w-full h-full object-contain mix-blend-multiply transition-transform duration-500 ${isOutOfStock ? 'grayscale opacity-50' : 'group-hover:scale-110'}`}/> : <span className="text-6xl group-hover:scale-110 transition-transform duration-300">📦</span>}
                  {appStock <= 5 && appStock > 0 && <span className="absolute top-2 left-2 bg-red-100 text-red-700 text-[10px] font-black px-2 py-1 rounded-lg shadow-sm">Only {appStock} left!</span>}
                  {isOutOfStock && <span className="absolute top-2 left-2 bg-gray-900 text-white text-[10px] font-black px-2 py-1 rounded-lg shadow-sm">Out of Stock</span>}
                </div>
                <div className="flex flex-col flex-1">
                  <span className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-1">{product.category || 'General'}</span>
                  <h3 className="font-bold text-gray-900 leading-tight mb-1 line-clamp-2 min-h-[40px] text-sm md:text-base">{product.name}</h3>
                  <div className="mt-auto pt-3 flex items-end justify-between">
                    <div>
                      {product.isSoldByWeight && <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mb-0.5">Price per KG</p>}
                      <p className="text-xl md:text-2xl font-black text-gray-900 tracking-tighter">₹{product.price}</p>
                    </div>

                    {isOutOfStock ? (
                      notifiedItems.includes(product.id) ? 
                        <span className="text-xs font-black text-green-600">Will Notify!</span> :
                        <button onClick={() => handleNotifyMe(product.id)} className="px-3 py-2 bg-blue-50 text-blue-600 rounded-xl font-black text-xs hover:bg-blue-100 border border-blue-200 cursor-pointer transition-colors">🔔 Notify</button>
                    ) : !cartItem ? (
                      <button onClick={() => handleAddClick(product, appStock)} className="px-5 py-2.5 bg-green-50 text-green-700 border border-green-200 hover:bg-green-600 hover:text-white rounded-xl font-black text-xs md:text-sm transition-all shadow-sm cursor-pointer transform active:scale-95 hover:shadow-md hover:-translate-y-0.5">ADD</button>
                    ) : (
                      <div className="flex items-center bg-green-600 text-white rounded-xl shadow-md h-10 w-24 md:w-28 overflow-hidden transition-all transform hover:scale-105">
                        <button onClick={() => cartItem.quantity <= stepAmount ? removeFromCart(product.id) : updateQuantity(product.id, cartItem.quantity - stepAmount)} className="flex-1 h-full flex items-center justify-center font-black hover:bg-green-700 cursor-pointer transition-colors">−</button>
                        <span className="flex-1 h-full flex items-center justify-center font-black text-sm bg-green-700/20">{cartItem.quantity}{product.isSoldByWeight && 'kg'}</span>
                        <button onClick={() => updateQuantity(product.id, cartItem.quantity + stepAmount)} disabled={cartItem.quantity >= appStock} className="flex-1 h-full flex items-center justify-center font-black hover:bg-green-700 disabled:opacity-50 cursor-pointer transition-colors">+</button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center mt-8">
          <button onClick={loadMore} className="bg-white border border-gray-200 text-gray-900 font-black px-8 py-3 rounded-full shadow-sm hover:shadow-md hover:border-gray-300 transition-all cursor-pointer">
            Load More Groceries ↓
          </button>
        </div>
      )}

      {cartItems.length > 0 && storeStatus?.isOpen && (
        <div className="fixed bottom-6 left-4 right-4 md:left-auto md:right-8 md:w-96 z-40 animate-slideUp">
          <div onClick={() => setIsCartOpen(true)} className="bg-green-600 text-white rounded-2xl p-4 shadow-2xl shadow-green-600/30 flex items-center justify-between cursor-pointer hover:bg-green-700 transition-all border-2 border-green-500 transform hover:-translate-y-1 active:scale-95 group">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-green-200 uppercase tracking-widest">{cartItems.length} Items Added</span>
              <span className="text-2xl font-black tracking-tight">₹{cartTotal}</span>
            </div>
            <div className="flex items-center gap-2 font-black text-lg">View Cart <span className="text-2xl transition-transform group-hover:translate-x-2">➔</span></div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ProductGrid;