const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: "djce5sfs6",  // Replace with your Cloudinary cloud name
  api_key: "399935783536349",        // Replace with your Cloudinary API key
  api_secret: "gzem1Q53gEqOCVdIYT9dMRyKaGk",  // Replace with your Cloudinary API secret
});

module.exports = cloudinary;
