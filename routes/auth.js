const express = require('express');
const authController = require('../controllers/auth')
const router = express.Router();
router.post('/register', authController.register);
router.post('/login', authController.login);
router.get("/logout", (req, res) => {
    res.clearCookie("authToken"); 
    res.redirect("/login");
});
module.exports = router;
