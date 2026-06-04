const express = require('express');
const { getActiveOffers, createOffer, disableOffer } = require('../controllers/offerController');
const { protect, admin } = require('../middlewares/authMiddleware');

const router = express.Router();

router.get('/active', getActiveOffers);
router.post('/', protect, admin, createOffer);
router.put('/:id/disable', protect, admin, disableOffer);

module.exports = router;