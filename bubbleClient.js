const axios = require("axios");

const client = axios.create({
  baseURL: process.env.BUBBLE_API_BASE,
  headers: {
    Authorization: `Bearer ${process.env.BUBBLE_API_TOKEN}`,
    "Content-Type": "application/json"
  }
});

async function getThing(type, id) {
    // console.log("URL",`${process.env.BUBBLE_API_BASE}/${type}/${id}`);
  const res = await client.get(`/${type}/${id}`);
  return res.data.response;
}

module.exports = { getThing };
