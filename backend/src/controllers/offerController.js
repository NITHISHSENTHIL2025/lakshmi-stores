const Offer = require('../models/Offer');

exports.getActiveOffers = async (req, res) => {
  try {
    const offers = await Offer.findAll({ where: { isActive: true } });
    res.json({ success: true, data: offers });
  } catch (error) { res.status(500).json({ success: false }); }
};

exports.createOffer = async (req, res) => {
  try {
    const offer = await Offer.create(req.body);
    res.json({ success: true, data: offer });
  } catch (error) { res.status(500).json({ success: false }); }
};

exports.disableOffer = async (req, res) => {
  try {
    await Offer.update({ isActive: false }, { where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) { res.status(500).json({ success: false }); }
};