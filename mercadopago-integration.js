// Mercado Pago Integration
async function finalizarMercadoPago(){
  if(!cart.length){ showToast('Seu carrinho est vazio.'); return; }
  if(!freteCalc || !CART_FRETE_STATUS.calculado){
    if(CART_FRETE_STATUS.outside){
      showToast('Fora da Grande Sao Paulo? Clique no link para frete especial via WhatsApp.');
    } else {
      showToast('Calcule o frete antes de finalizar.');
    }
    return;
  }
  var nome    = document.getElementById('co-nome').value.trim();
  var tel     = document.getElementById('co-tel').value.trim();
  var end     = document.getElementById('co-endereco').value.trim();
  var num     = document.getElementById('co-numero').value.trim();
  var comp    = document.getElementById('co-complemento').value.trim();
  var bairro  = document.getElementById('co-bairro').value.trim();
  var cidade  = document.getElementById('co-cidade').value.trim();
  var ref     = document.getElementById('co-referencia').value.trim();
  var horario = selectedHorario;
  var endCompleto = end + ', ' + num + ( ' + comp : '') + ', ' + bairro + ', ' + cidade;comp ? ' 
  var items = cart.map(function(ci){
    var p = ALL_PRODUCTS.find(function(x){ return x.id === ci.id; });
    return p ? { productId: p.id, qty: ci.qty } : null;
  }).filter(Boolean);
  var btn = document.getElementById('btn-mercadopago-checkout');
  var originalText = btn.innerHTML;
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Aguarde...';
  btn.style.opacity = '0.7';
  btn.disabled = true;
  try {
    var response = await fetch('/.netlify/functions/mercadopago-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: items,
        frete: freteVal || 0,
        customerInfo: {
          nome: nome,
          tel: tel,
          email: '',
          endereco: endCompleto,
          horario: horario,
          referencia: ref,
          cep: document.getElementById('co-cep').value.trim()
        }
      })
    });
    var data = await response.json();
    if(!response.ok || !data.init_point){
      throw new Error(data.error || 'Erro ao criar preferncia de pagamento.');
    }
    var orders = getOrders();
    orders.unshift({
      id: '#' + String(Date.now()).slice(-6),
      status: 'aguardando_pagamento',
      nome: nome, tel: tel,
      endereco: endCompleto,
      bairro: bairro, cidade: cidade,
      referencia: ref, horario: horario,
      frete: freteVal || 0,
      subtotal: cartSubtotal(),
      total: cartSubtotal() + (freteVal || 0),
      items: cart.map(function(ci){
        var p = getProduct(ci.id);
        return p ? (ci.qty + 'x ' + p.name) : '';
      }).filter(Boolean),
      mercadopagoPreference: data.preference_id,
      createdAt: new Date().toISOString()
    });
    setOrders(o    setOrders(o  w.location.href = data.init_point;
  } catch(err){
    btn.innerHTML = originalText;
    btn.style.opacity = '';
    btn.disabled = false;
    showToast('Erro: ' + err. tente via WhatsApp.');message + ' 
    console.error('Mercado Pago error:', err);
  }
}
(function checkMercadoPagoReturn(){
  if(window.location.pathname === '/sucesso'){
    cart = []; saveCart(); updateBadge(); renderCart();
    history.replaceState({}, '', '/sucesso');
  }
})();
