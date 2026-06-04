import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';

const AdminOfferPanel = () => {
  const [offers, setOffers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  // Form State
  const [type, setType] = useState('COMBO');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [comboPrice, setComboPrice] = useState('');
  const [discountPercentage, setDiscountPercentage] = useState('');
  const [selectedProductIds, setSelectedProductIds] = useState([]);

  const fetchInitialData = async () => {
    try {
      const [offerRes, prodRes] = await Promise.all([
        api.get('/offers/active'),
        api.get('/products?limit=1000')
      ]);
      setOffers(offerRes.data.data || []);
      setProducts(prodRes.data.data || []);
    } catch (e) { toast.error('Failed to load offers'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchInitialData(); }, []);

  const toggleProductSelection = (id) => {
    setSelectedProductIds(prev => 
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const handleCreateOffer = async (e) => {
    e.preventDefault();
    if (selectedProductIds.length === 0) return toast.error("Select at least one product.");
    
    try {
      await api.post('/offers', {
        type, title, description,
        comboPrice: type === 'COMBO' ? Number(comboPrice) : null,
        discountPercentage: type === 'DISCOUNT' ? Number(discountPercentage) : 0,
        targetProductIds: selectedProductIds
      });
      toast.success('Offer Created!');
      fetchInitialData();
      setTitle(''); setDescription(''); setComboPrice(''); setDiscountPercentage(''); setSelectedProductIds([]);
    } catch (err) { toast.error('Failed to create offer'); }
  };

  const disableOffer = async (id) => {
    try {
      await api.put(`/offers/${id}/disable`);
      toast.success('Offer disabled');
      fetchInitialData();
    } catch (e) { toast.error('Failed to disable'); }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 anim-slide-up">
      {/* Creation Form */}
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-gray-100">
        <h2 className="text-2xl font-black text-gray-900 mb-6">Create New Offer</h2>
        <form onSubmit={handleCreateOffer} className="space-y-4">
          <div className="flex gap-4 mb-6">
            <button type="button" onClick={() => setType('COMBO')} className={`flex-1 py-3 rounded-xl font-black transition-colors ${type === 'COMBO' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-500'}`}>COMBO</button>
            <button type="button" onClick={() => setType('DISCOUNT')} className={`flex-1 py-3 rounded-xl font-black transition-colors ${type === 'DISCOUNT' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'}`}>% DISCOUNT</button>
          </div>

          <input type="text" placeholder="Offer Title (e.g., Breakfast Combo)" value={title} onChange={e => setTitle(e.target.value)} required className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold" />
          <input type="text" placeholder="Short Description" value={description} onChange={e => setDescription(e.target.value)} required className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold" />

          {type === 'COMBO' ? (
            <input type="number" placeholder="Combo Final Price (₹)" value={comboPrice} onChange={e => setComboPrice(e.target.value)} required className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold" />
          ) : (
            <input type="number" placeholder="Discount Percentage (%)" value={discountPercentage} onChange={e => setDiscountPercentage(e.target.value)} required className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl font-bold" />
          )}

          <div className="mt-6 border border-gray-200 rounded-xl p-4 bg-gray-50 h-64 overflow-y-auto">
            <p className="text-xs font-black text-gray-400 uppercase mb-3">Select Items for this Offer</p>
            {products.map(p => (
              <label key={p.id} className="flex items-center gap-3 mb-2 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors">
                <input type="checkbox" checked={selectedProductIds.includes(p.id)} onChange={() => toggleProductSelection(p.id)} className="w-5 h-5 accent-orange-500" />
                <span className="font-bold text-gray-700 text-sm">{p.name} (₹{p.price})</span>
              </label>
            ))}
          </div>

          <button type="submit" className="w-full py-4 bg-gray-900 text-white font-black rounded-xl hover:bg-black mt-4 transition-colors">
            Deploy Offer Live
          </button>
        </form>
      </div>

      {/* Active Offers List */}
      <div>
        <h2 className="text-2xl font-black text-gray-900 mb-6">Active Offers</h2>
        <div className="space-y-4">
          {offers.length === 0 ? <p className="text-gray-400 font-bold">No active offers.</p> : null}
          {offers.map(offer => (
            <div key={offer.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm flex justify-between items-center">
              <div>
                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-md mb-2 inline-block ${offer.type === 'COMBO' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>{offer.type}</span>
                <h3 className="font-black text-lg text-gray-900">{offer.title}</h3>
                <p className="text-xs font-bold text-gray-500 mt-1">{offer.targetProductIds.length} items linked</p>
              </div>
              <button onClick={() => disableOffer(offer.id)} className="bg-red-50 text-red-600 font-black px-4 py-2 rounded-xl text-xs hover:bg-red-100 transition-colors">
                Disable
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminOfferPanel;