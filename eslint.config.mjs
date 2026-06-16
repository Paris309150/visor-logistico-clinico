export default [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        alert: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Math: "readonly",
        Date: "readonly",
        Number: "readonly",
        isNaN: "readonly",
        Intl: "readonly",
        confirm: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        navigator: "readonly",
        Blob: "readonly",
        URL: "readonly",
        File: "readonly",
        FileReader: "readonly",
        Array: "readonly",
        Object: "readonly",
        String: "readonly",
        Boolean: "readonly",
        Error: "readonly",
        Promise: "readonly",
        Map: "readonly",
        Set: "readonly"
      }
    },
    rules: {
      "no-undef": "error"
    }
  }
];
