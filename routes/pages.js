const express = require('express');
const db = require("../app");
const { isAuthenticated, isAdmin, isCustomer } = require("../middleware/authMiddleware");
const router = express.Router();
router.use((req, res, next) => {
    if (req.cookies.authToken) {
        const token = req.cookies.authToken;
        try{
            const decoded = require("jsonwebtoken").verify(token, process.env.JWT_SECRET);
            req.userId = decoded.id;
            req.userRole = decoded.role; 
        }catch(err){
            return res.redirect("/login");
        }
    }
    next();
});
router.get('/', (req, res) => {
    res.render('index');
});
router.get('/login', (req, res) => {
    res.render('login');
});
router.get('/register', (req, res) => {
    res.render('register');
});
router.get("/admin", isAuthenticated, isAdmin, async (req, res) => {
    const db = req.db;

    if (!db) {
        console.error("Database connection is missing!");
        return res.status(500).send("Database connection error.");
    }

    try {
        const [medicines, rawOrders, purchases, balanceResult] = await Promise.all([
            new Promise((resolve, reject) => {
                db.query("SELECT * FROM medicines", (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                });
            }),
            new Promise((resolve, reject) => {
                db.query(
                    `SELECT o.orderId, o.customerId, o.quantity, o.orderDate, o.totalPrice, 
                            m.medicineName, m.medicineId 
                     FROM orders o 
                     JOIN medicines m ON o.medicineId = m.medicineId 
                     ORDER BY o.orderDate DESC`, 
                    (err, results) => {
                        if (err) return reject(err);
                        resolve(results);
                    }
                );
            }),
            new Promise((resolve, reject) => {
                db.query("SELECT * FROM purchases ORDER BY purchaseDate DESC", 
                (err, results) => {
                    if (err) return reject(err);
                    resolve(results);
                });
            }),
            new Promise((resolve, reject) => {
                db.query("SELECT SUM(totalPrice) AS totalBalance FROM orders", 
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result);
                });
            })
        ]);

        const adminBalance = balanceResult[0].totalBalance || 0; // Default to 0 if no orders

        res.render("admin", { medicines, orders: rawOrders, purchases, adminBalance });
    } catch (error) {
        console.error("Error fetching admin data:", error);
        res.status(500).send("Error loading admin data.");
    }
});

router.get("/admin/add-medicine", isAuthenticated, (req, res) => {
    res.render("add-medicine");
});
router.post("/admin/add-medicine", isAuthenticated, (req, res) => {
    const db = req.db;
    const { medicineName, medicineCategory, medicineManufacturer, medicinePrice, medicineStockQuantity, medicineExpiryDate } = req.body;
    db.query(
        "INSERT INTO medicines (medicineName, medicineCategory, medicineManufacturer, medicinePrice, medicineStockQuantity, medicineExpiryDate) VALUES (?, ?, ?, ?, ?, ?)",
        [medicineName, medicineCategory, medicineManufacturer, medicinePrice, medicineStockQuantity, medicineExpiryDate],
        (err, result) => {
            if (err) {
                console.error("Error adding medicine:", err);
                return res.render("admin", { message: "Database error. Try again." });
            }
            console.log("Medicine added successfully:", result);
            return res.redirect("/admin");
        }
    );
});
router.post("/admin/delete-medicine", isAuthenticated, (req, res) => {
    const db = req.db;
    const { medicineId } = req.body;
    db.query("DELETE FROM medicines WHERE medicineId = ?", [medicineId], (err, result) => {
        if (err) {
            console.error("Error deleting medicine:", err);
            return res.render("admin", { message: "Error deleting medicine." });
        }
        console.log("Medicine deleted successfully:", result);
        return res.redirect("/admin");
    });
});
router.post("/admin/add-medicine-stock", isAuthenticated, isAdmin, (req, res) => {
    const db = req.db;
    const { medicineId, additionalStock } = req.body;

    if (!medicineId || additionalStock === undefined) {
        return res.redirect("/admin");
    }
    const addedStock = parseInt(additionalStock, 10);
    if (isNaN(addedStock) || addedStock <= 0) {
        console.error("Invalid stock quantity:", addedStock);
        return res.redirect("/admin");
    }
    db.query("UPDATE medicines SET medicineStockQuantity = medicineStockQuantity + ? WHERE medicineId = ?", 
    [addedStock, medicineId], (err, result) => {
        if (err) {
            console.error("Error adding medicine stock:", err);
            return res.redirect("/admin");
        }
        console.log("Medicine stock increased successfully:", result);
        return res.redirect("/admin");
    });
});
router.get("/admin/orders", isAuthenticated, isAdmin, (req, res) => {
    const db = req.db;
    const query = `
        SELECT 
            o.orderId, 
            o.customerId, 
            o.medicineId, 
            o.quantity, 
            o.orderDate, 
            o.totalPrice
        FROM orders o
        JOIN customers c ON o.customerId = c.customerId
        JOIN medicines m ON o.medicineId = m.medicineId
        ORDER BY o.orderDate DESC;`;
    db.query(query, (err, results) => {
        if (err) {
            console.error("Error fetching orders:", err);
            return res.redirect("/admin");
        }
        console.log("Orders Fetched:", results); 
        res.render("adminOrders", { orders: results });
    });
});
router.get("/admin/get-balance", isAuthenticated, isAdmin, (req, res) => {
    const db = req.db;
    
    db.query("SELECT SUM(totalPrice) AS balance FROM orders", (err, results) => {
        if (err) {
            console.error("Error fetching balance:", err);
            return res.json({ success: false });
        }
        
        const balance = results[0].balance || 0; // Default to 0 if no orders
        res.json({ success: true, balance });
    });
});

router.get("/user", isAuthenticated, isCustomer, (req, res) => {
    const db = req.db;
    const userId = req.userId; 
    if (!db) {
        console.error("Database connection is missing!");
        return res.status(500).send("Database connection error.");
    }
    db.query("SELECT * FROM medicines WHERE medicineStockQuantity > 0", (err, medicines) => {
        if (err) {
            medicines = [];
        }
        db.query(
            `SELECT orders.quantity, orders.orderDate, orders.totalPrice, medicines.medicineName 
            FROM orders 
            JOIN medicines ON orders.medicineId = medicines.medicineId 
            WHERE orders.customerId = ?`, 
            [userId], 
            (err, orders) => {
                if (err) {
                    orders = [];
                }
                res.render("user-dashboard", { medicines, orders });
            }
        );
    });
});
router.post("/user/order", isAuthenticated, isCustomer, (req, res) => {
    const userId = req.userId;
    const db = req.db;
    const medicineIds = req.body.medicineId;
    const quantities = req.body.quantity;
    if (!medicineIds || !quantities) {
        return res.redirect("/user");
    }
    const medicineArray = Array.isArray(medicineIds) ? medicineIds : [medicineIds];
    const quantityArray = Array.isArray(quantities) ? quantities : [quantities];
    let orderQueries = [];
    let purchaseQueries = [];
    let stockUpdates = [];
    let queriesCompleted = 0;
    medicineArray.forEach((medicineId, index) => {
        let quantity = parseInt(quantityArray[index]);
        db.query("SELECT medicinePrice, medicineStockQuantity FROM medicines WHERE medicineId = ?", [medicineId], (err, results) => {
            if (err || results.length === 0) {
                console.error("Error fetching medicine details:", err);
                return res.redirect("/user");
            }
            const price = parseFloat(results[0].medicinePrice);
            const totalPrice = price * quantity;
            const currentStock = parseInt(results[0].medicineStockQuantity);
            if (currentStock < quantity) {
                console.error("Not enough stock for medicineId:", medicineId);
                return res.redirect("/user");
            }
            orderQueries.push([userId, medicineId, quantity, new Date(), totalPrice]);
            purchaseQueries.push([userId, medicineId, new Date(), quantity, price]);
            stockUpdates.push({ medicineId, newStock: currentStock - quantity });
            if (orderQueries.length === medicineArray.length) {
                db.query("INSERT INTO orders (customerId, medicineId, quantity, orderDate, totalPrice) VALUES ?", 
                [orderQueries], (err) => {
                    if (err) {
                        console.error("Error placing order:", err);
                        return res.redirect("/user");
                    }
                    db.query("INSERT INTO purchases (userId, medicineId, purchaseDate, quantity, costPrice) VALUES ?", 
                    [purchaseQueries], (err) => {
                        if (err) {
                            console.error("Error inserting into purchases:", err);
                            return res.redirect("/user");
                        }
                        stockUpdates.forEach(({ medicineId, newStock }) => {
                            db.query("UPDATE medicines SET medicineStockQuantity = ? WHERE medicineId = ?", 
                            [newStock, medicineId], (err) => {
                                if (err) {
                                    console.error("Error updating stock for medicineId:", medicineId, err);
                                }
                            });
                        });

                        console.log("Order placed, purchases recorded, and stock updated successfully!");
                        return res.redirect("/user");
                    });
                });
                
            }
        });
    });
});
router.get("/user/orders", isAuthenticated, isCustomer, (req, res) => {
    const userId = req.userId;
    const db = req.db;

    db.query("SELECT * FROM orders WHERE customerId = ? ORDER BY orderDate DESC", [userId], (err, results) => {
        if (err) {
            console.error("❌ Error fetching orders:", err);
            return res.redirect("/user");
        }
        res.render("orders", { orders: results }); // Adjust based on your frontend rendering
    });
});
router.get("/logout", (req, res) => {
    if (!req.session) {
        return res.redirect("/login");
    }
});
module.exports = router;