import { useState, useEffect } from 'react';
import api from '../api/axios';

const PREDEFINED_CATEGORIES = [
  { name: 'Packaged Snacks', type: 'piece' },
  { name: 'Dairy & Eggs', type: 'piece' },
  { name: 'Beverages', type: 'piece' },
  { name: 'Cleaning & Household', type: 'piece' },
  { name: 'Vegetables', type: 'weight' },
  { name: 'Fruits', type: 'weight' },
  { name: 'Loose Provisions (Dal, Rice, Sugar)', type: 'weight' },
  { name: '+ Add Custom Category...', type: 'custom' }
];

const AdminProductManager = () => {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Smart Form State
  const [formData, setFormData] = useState({
    id: null,
    name: '',
    categorySelection: 'Packaged Snacks',
    customCategoryName: '',
    measurementType: 'piece', // 'piece' or 'weight'
    description: '',
    price: '',
    stock: '',
    imageUrl: ''
  });

  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      const response = await api.get('/products');
      setProducts(response.data.data);
    } catch (error) {
      console.error("Error fetching products:", error);
    } finally {
      setLoading(false);
    }
  };

  // 🚨 SMART DROPDOWN LOGIC 🚨
  const handleCategoryChange = (e) => {
    const selected = e.target.value;
    const catData = PREDEFINED_CATEGORIES.find(c => c.name === selected);
    
    setFormData({
      ...formData,
      categorySelection: selected,
      measurementType: catData ? catData.type : 'piece' // Auto-switch to weight if Vegetables/Fruits!
    });
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setImagePreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const openModal = (product = null) => {
    if (product) {
      // Determine if it was a weight-based product (has 'loose' in the name)
      const isWeight = product.category?.toLowerCase().includes('loose');
      
      setFormData({
        id: product.id,
        name: product.name,
        categorySelection: '+ Add Custom Category...', // Default to custom if editing to show raw category
        customCategoryName: product.category,
        measurementType: isWeight ? 'weight' : 'piece',
        description: product.description || '',
        price: product.price,
        stock: product.real_stock ?? product.stock, // Fallback check
        imageUrl: product.imageUrl || ''
      });
      setImagePreview(product.imageUrl || null);
    } else {
      setFormData({
        id: null, name: '', categorySelection: 'Vegetables', customCategoryName: '', measurementType: 'weight', description: '', price: '', stock: '', imageUrl: ''
      });
      setImagePreview(null);
    }
    setImageFile(null);
    setIsModalOpen(true);
  };

  const saveProduct = async () => {
    setIsSaving(true);
    try {
      // 1. Determine the final Category Name to save to the database
      let finalCategory = formData.categorySelection === '+ Add Custom Category...' 
        ? formData.customCategoryName 
        : formData.categorySelection;

      // 🚨 SECRET TAGGING: If sold by weight, ensure "Loose" is in the category name 
      // so the Customer Storefront knows to trigger the 500g/1kg popup later!
      if (formData.measurementType === 'weight' && !finalCategory.toLowerCase().includes('loose')) {
        finalCategory += ' (Loose)';
      }

      // 🚨 SPRINT 4 FIX: Package data as FormData so the image file can be sent to Cloudinary
      const submitData = new FormData();
      submitData.append('name', formData.name);
      submitData.append('category', finalCategory);
      submitData.append('description', formData.description);
      submitData.append('price', Number(formData.price));
      submitData.append('stock', Number(formData.stock));
      
      // Attach the physical file if they uploaded a new one
      if (imageFile) {
        submitData.append('image', imageFile);
      }

      if (formData.id) {
        await api.put(`/products/${formData.id}`, submitData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      } else {
        await api.post('/products', submitData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
      }

      setIsModalOpen(false);
      fetchProducts();
    } catch (error) {
      alert("Failed to save product.");
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  };

  const deleteProduct = async (id) => {
    if (window.confirm("Are you sure you want to delete this product?")) {
      try {
        await api.delete(`/products/${id}`);
        fetchProducts();
      } catch (error) { console.error("Failed to delete", error); }
    }
  };

  if (loading) return <div className="p-8 font-bold text-gray-400">Loading catalog...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Product Catalog</h1>
          <p className="text-gray-500 font-bold">Manage your inventory, prices, and categories.</p>
        </div>
        <button onClick={() => openModal()} className="bg-orange-600 text-white px-6 py-3 rounded-xl font-black shadow-lg shadow-orange-500/30 hover:bg-orange-700 transition cursor-pointer">
          + Add New Product
        </button>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100 text-xs font-black text-gray-400 uppercase tracking-wider">
              <th className="p-5">Product</th>
              <th className="p-5">Category & Type</th>
              <th className="p-5">Price</th>
              <th className="p-5">Current Stock</th>
              <th className="p-5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {products.map(product => {
              const isWeight = product.category?.toLowerCase().includes('loose');
              return (
                <tr key={product.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-5 flex items-center gap-4">
                    <div className="w-12 h-12 bg-gray-100 rounded-xl overflow-hidden flex items-center justify-center border border-gray-200">
                      {product.imageUrl ? <img src={product.imageUrl} className="w-full h-full object-cover"/> : <span>📦</span>}
                    </div>
                    <span className="font-bold text-gray-900">{product.name}</span>
                  </td>
                  <td className="p-5">
                    <span className="font-bold text-gray-600 block">{product.category}</span>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${isWeight ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-700'}`}>
                      {isWeight ? 'Sold by Weight (KG)' : 'Sold by Piece'}
                    </span>
                  </td>
                  <td className="p-5 font-black text-gray-900">₹{product.price} {isWeight && <span className="text-xs text-gray-400 font-bold">/ kg</span>}</td>
                  <td className="p-5">
                    <span className={`font-black ${(product.real_stock ?? product.stock) <= 3 ? 'text-red-600' : 'text-green-600'}`}>
                      {product.real_stock ?? product.stock} {isWeight ? 'kg' : 'units'}
                    </span>
                  </td>
                  <td className="p-5 text-right space-x-2">
                    <button onClick={() => openModal(product)} className="px-4 py-2 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition cursor-pointer">Edit</button>
                    <button onClick={() => deleteProduct(product.id)} className="px-4 py-2 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-100 transition cursor-pointer">Delete</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 🚨 THE SMART MODAL 🚨 */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden animate-slideInRight border border-gray-100">
            
            <div className="p-6 md:p-8 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">{formData.id ? 'Edit Product' : 'Add New Real Product'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-red-500 text-2xl font-black transition cursor-pointer">✕</button>
            </div>

            <div className="p-6 md:p-8 space-y-6">
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-black text-gray-900 uppercase tracking-widest mb-2">Product Name</label>
                  <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-bold focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition" placeholder="e.g., Red Onion" />
                </div>
                
                {/* 🚨 SMART CATEGORY DROPDOWN 🚨 */}
                <div>
                  <label className="block text-xs font-black text-gray-900 uppercase tracking-widest mb-2">Category Setup</label>
                  <select value={formData.categorySelection} onChange={handleCategoryChange} className="w-full px-4 py-3 bg-white border-2 border-orange-300 rounded-xl font-bold text-orange-900 focus:ring-2 focus:ring-orange-500 outline-none transition cursor-pointer shadow-sm">
                    {PREDEFINED_CATEGORIES.map(cat => (
                      <option key={cat.name} value={cat.name}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 🚨 CUSTOM CATEGORY BUILDER 🚨 */}
              {formData.categorySelection === '+ Add Custom Category...' && (
                <div className="bg-orange-50 p-5 rounded-2xl border border-orange-100 grid grid-cols-1 md:grid-cols-2 gap-6 animate-fadeIn">
                  <div>
                    <label className="block text-xs font-black text-orange-800 uppercase tracking-widest mb-2">New Category Name</label>
                    <input type="text" value={formData.customCategoryName} onChange={e => setFormData({...formData, customCategoryName: e.target.value})} className="w-full px-4 py-3 bg-white border border-orange-200 rounded-xl font-bold focus:ring-2 focus:ring-orange-500 outline-none" placeholder="e.g., Imported Chocolates" />
                  </div>
                  <div>
                    <label className="block text-xs font-black text-orange-800 uppercase tracking-widest mb-2">How is it sold?</label>
                    <div className="flex bg-white rounded-xl border border-orange-200 overflow-hidden p-1">
                      <button onClick={() => setFormData({...formData, measurementType: 'piece'})} className={`flex-1 py-2 text-sm font-black rounded-lg transition-colors cursor-pointer ${formData.measurementType === 'piece' ? 'bg-orange-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}>By Piece/Packet</button>
                      <button onClick={() => setFormData({...formData, measurementType: 'weight'})} className={`flex-1 py-2 text-sm font-black rounded-lg transition-colors cursor-pointer ${formData.measurementType === 'weight' ? 'bg-blue-500 text-white shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}>By Weight (KG)</button>
                    </div>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-black text-gray-900 uppercase tracking-widest mb-2">Description (Optional)</label>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition h-20 resize-none" placeholder="Freshly sourced daily..."></textarea>
              </div>

              {/* 🚨 SMART PRICING LABELS 🚨 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-50 p-5 rounded-2xl border border-gray-100">
                <div>
                  <label className={`block text-xs font-black uppercase tracking-widest mb-2 ${formData.measurementType === 'weight' ? 'text-blue-600' : 'text-gray-900'}`}>
                    {formData.measurementType === 'weight' ? 'Price per 1 KG (₹)' : 'Price per Packet/Piece (₹)'}
                  </label>
                  <input type="number" value={formData.price} onChange={e => setFormData({...formData, price: e.target.value})} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-black text-lg focus:ring-2 focus:ring-orange-500 outline-none transition shadow-sm" placeholder="e.g., 40" />
                </div>
                <div>
                  <label className={`block text-xs font-black uppercase tracking-widest mb-2 ${formData.measurementType === 'weight' ? 'text-blue-600' : 'text-gray-900'}`}>
                    {formData.measurementType === 'weight' ? 'Total Stock (in KG)' : 'Total Stock Quantity'}
                  </label>
                  <input type="number" value={formData.stock} onChange={e => setFormData({...formData, stock: e.target.value})} className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-black text-lg focus:ring-2 focus:ring-orange-500 outline-none transition shadow-sm" placeholder="e.g., 50" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-gray-900 uppercase tracking-widest mb-2">Product Image</label>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-24 border-2 border-dashed border-gray-300 rounded-2xl flex items-center justify-center bg-gray-50 overflow-hidden relative group">
                     {imagePreview ? <img src={imagePreview} className="w-full h-full object-cover" /> : <span className="text-3xl text-gray-300">📸</span>}
                  </div>
                  <div className="flex-1">
                    <input type="file" onChange={handleImageChange} className="block w-full text-sm text-gray-500 file:mr-4 file:py-3 file:px-6 file:rounded-xl file:border-0 file:text-sm file:font-black file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 cursor-pointer transition" accept="image/*" />
                    <p className="text-xs text-gray-400 font-bold mt-2">JPEG or PNG. Max size 2MB.</p>
                  </div>
                </div>
              </div>

            </div>

            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
              <button onClick={() => setIsModalOpen(false)} className="px-6 py-3 text-gray-600 font-bold hover:bg-gray-200 rounded-xl transition cursor-pointer">Cancel</button>
              <button onClick={saveProduct} disabled={isSaving} className="px-8 py-3 bg-orange-600 text-white font-black rounded-xl shadow-lg hover:bg-orange-700 transition disabled:opacity-50 flex items-center gap-2 cursor-pointer">
                {isSaving ? 'Saving...' : 'Save Product Data'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminProductManager;