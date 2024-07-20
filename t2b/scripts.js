// scripts.js

function textToBinary() {
    const text = document.getElementById('textInput').value;
    const binary = text.split('')
        .map(char => char.charCodeAt(0).toString(2).padStart(8, '0'))
        .join(' ');
    document.getElementById('binaryOutput').value = binary;
}

function binaryToText() {
    const binary = document.getElementById('binaryInput').value;
    const text = binary.split(' ')
        .map(bin => String.fromCharCode(parseInt(bin, 2)))
        .join('');
    document.getElementById('textOutput').value = text;
}
