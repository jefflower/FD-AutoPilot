
const API_Base = 'http://localhost:9988/api/v1';

async function testPersistence() {
    try {
        // 1. Get a ticket
        console.log('Fetching tickets...');
        const listResp = await fetch(`${API_Base}/tickets?size=1`);
        const listJson = await listResp.json();

        if (!listJson.success || !listJson.data.content.length) {
            console.error('No tickets found to test.');
            return;
        }

        const ticket = listJson.data.content[0];
        console.log(`Found ticket #${ticket.id} (External: ${ticket.externalId})`);

        // 2. Submit Translation
        const payload = {
            targetLang: 'zh-CN',
            translatedTitle: `[Test ${Date.now()}] ${ticket.subject}`,
            translatedContent: JSON.stringify({
                description: "Test Description Translation",
                conversations: []
            })
        };
        console.log('Submitting translation:', payload);

        const submitResp = await fetch(`${API_Base}/tickets/${ticket.id}/translation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const submitJson = await submitResp.json();
        console.log('Submit response:', submitJson);

        if (!submitJson.success) {
            console.error('Submit failed!');
            return;
        }

        // 3. Fetch Ticket again to verify
        // Wait a bit just in case of async indexing (though H2 is sync)
        await new Promise(r => setTimeout(r, 500));

        console.log(`Re-fetching ticket #${ticket.id}...`);
        const verifyResp = await fetch(`${API_Base}/tickets/${ticket.id}?_t=${Date.now()}`);
        const verifyJson = await verifyResp.json();
        const updatedTicket = verifyJson.data;

        console.log('Updated Ticket Translation:', updatedTicket.translation);

        if (updatedTicket.translation && updatedTicket.translation.translatedTitle === payload.translatedTitle) {
            console.log('✅ PERSISTENCE TEST PASSED: Translation saved and retrieved.');
        } else {
            console.error('❌ PERSISTENCE TEST FAILED: Translation not found or mismatch.');
            console.log('Expected:', payload.translatedTitle);
            console.log('Actual:', updatedTicket.translation ? updatedTicket.translation.translatedTitle : 'null');
        }

    } catch (e) {
        console.error('Test Error:', e);
    }
}

testPersistence();
